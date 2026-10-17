import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BULK_IMPORT } from '../../../../shared/constants';
import type { MapLinkPreview, Restaurant, RestaurantImportResponse, TreatType, VenuePurpose } from '../../../../shared/types';
import type { LocationField } from '../../lib/venueForm';
import { api, ApiError, newIdempotencyKey } from '../../api/client';
import { keys } from '../../api/queries';
import { loadBulkDraft, saveBulkDraft } from '../../lib/bulkDraft';
import {
  addTagsToSelected,
  analyzeQueue,
  applyCommitResults,
  applyFailure,
  applyGeo,
  applyPreview,
  editRowLocation,
  failGeo,
  fillLocationSelected,
  isGeoFailed,
  markGeoPending,
  nextGeo,
  queueGeo,
  setPurposesSelected,
  setRowPurposes,
  setRowTreatTypes,
  setTreatTypesSelected,
  type BatchFillResult,
  buildPendingCommit,
  commitRows,
  countQueue,
  editRow,
  emptyQueue,
  isLocked,
  isBulkRetryable,
  markResolving,
  nextToResolve,
  parsePaste,
  requeue,
  retryRow,
  selectImportable,
  setManual,
  type BatchTagResult,
  type PasteResult,
  type QueueRow,
  type QueueState,
  type RowEdit,
} from '../../lib/bulkQueue';

export const RESTAURANTS_KEY = ['admin', 'restaurant'] as const;

const mapRow = (s: QueueState, id: string, fn: (r: QueueRow) => QueueRow): QueueState => ({
  ...s,
  rows: s.rows.map((r) => (r.id === id ? fn(r) : r)),
});

/** Row updates are ignored while the row is part of an unanswered import (its payload is fixed). */
const guard = (fn: (r: QueueRow) => QueueRow) => (s: QueueState, id: string) => (isLocked(s, id) ? s : mapRow(s, id, fn));

const newRowId = () => crypto.randomUUID();

function retryAfterOf(err: ApiError): number {
  const value = (err.details as { retryAfter?: unknown } | undefined)?.retryAfter;
  return typeof value === 'number' && value > 0 ? Math.min(value, 3600) : 60;
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export interface CommitOutcome {
  created: number;
  duplicates: number;
  errors: number;
  replayed: boolean;
}

export function useBulkImport() {
  const queryClient = useQueryClient();
  const restaurants = useQuery({ queryKey: RESTAURANTS_KEY, queryFn: () => api<Restaurant[]>('GET', '/admin/restaurants') });
  const [initial] = useState(loadBulkDraft);
  const [state, setState] = useState<QueueState>(() => initial.state ?? emptyQueue());
  const [storageOk, setStorageOk] = useState(true);
  const [running, setRunning] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null);
  /** Also ask for a region suggestion while identifying links (user-started, shared server rate limit). */
  const [withGeo, setWithGeo] = useState(true);
  const withGeoRef = useRef(withGeo);
  withGeoRef.current = withGeo;

  const inFlight = useRef(new Map<string, AbortController>());
  const committing = useRef(false);
  const mounted = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const info = useMemo(() => analyzeQueue(state, restaurants.data ?? null), [state, restaurants.data]);
  const infoRef = useRef(info);
  infoRef.current = info;
  const counts = useMemo(() => countQueue(state, info), [state, info]);

  // Every change is kept in this tab, so a reload or leaving the page loses nothing.
  useEffect(() => setStorageOk(saveBulkDraft(state)), [state]);

  useEffect(() => {
    mounted.current = true;
    const controllers = inFlight.current;
    return () => {
      mounted.current = false;
      // Stop previews quietly; the draft keeps those rows waiting for the next visit.
      for (const c of controllers.values()) c.abort();
      controllers.clear();
    };
  }, []);

  const busy = commitBusy || running;
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  useEffect(() => {
    if (pausedUntil === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pausedUntil]);
  const waitSeconds = pausedUntil === null ? 0 : Math.max(0, Math.ceil((pausedUntil - now) / 1000));

  const resolveRow = useCallback((row: QueueRow) => {
    const controller = new AbortController();
    inFlight.current.set(row.id, controller);
    const sent = row.sourceUrl;
    setState((s) => mapRow(s, row.id, markResolving));
    api<MapLinkPreview>('POST', '/admin/restaurants/resolve-map-link', {
      json: withGeoRef.current ? { url: sent, geo: true } : { url: sent },
      signal: controller.signal,
    })
      .then((preview) => setState((s) => mapRow(s, row.id, (r) => applyPreview(r, sent, preview))))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 429) {
          const wait = retryAfterOf(err);
          setState((s) => mapRow(s, row.id, (r) => requeue(r, sent)));
          setRunning(false);
          setNow(Date.now());
          setPausedUntil(Date.now() + wait * 1000);
          setAnnouncement(`识别太频繁，已暂停。请 ${wait} 秒后点「继续识别」`);
          return;
        }
        setState((s) => mapRow(s, row.id, (r) => applyFailure(r, sent, errorText(err, '识别失败，请稍后重试'))));
      })
      .finally(() => {
        inFlight.current.delete(row.id);
        if (mounted.current) setTick((t) => t + 1);
      });
  }, []);

  /** One region lookup (again) for a row whose link is already known; the answer only fills empty fields. */
  const resolveGeo = useCallback((row: QueueRow) => {
    const sent = row.geo.url;
    if (!sent) return;
    const key = `geo:${row.id}`;
    const controller = new AbortController();
    inFlight.current.set(key, controller);
    setState((s) => mapRow(s, row.id, markGeoPending));
    api<MapLinkPreview>('POST', '/admin/restaurants/resolve-map-link', { json: { url: sent, geo: true }, signal: controller.signal })
      .then((preview) => {
        const outcome = preview.geo ?? { status: 'unavailable' as const, message: '这次没有返回地区建议' };
        setState((s) => mapRow(s, row.id, (r) => applyGeo(r, sent, outcome)));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 429) {
          const wait = retryAfterOf(err);
          setState((s) => mapRow(s, row.id, (r) => failGeo(r, sent, '', true)));
          setRunning(false);
          setNow(Date.now());
          setPausedUntil(Date.now() + wait * 1000);
          setAnnouncement(`识别太频繁，已暂停。请 ${wait} 秒后点「继续识别」`);
          return;
        }
        setState((s) => mapRow(s, row.id, (r) => failGeo(r, sent, errorText(err, '地区识别失败，可以稍后重试或手动填写'))));
      })
      .finally(() => {
        inFlight.current.delete(key);
        if (mounted.current) setTick((t) => t + 1);
      });
  }, []);

  // The queue runner: at most two previews at a time, in row order, never on its own after a 429.
  // Region retries go one at a time after the links (the server spaces them out anyway).
  useEffect(() => {
    if (!running) return;
    const active = new Set(inFlight.current.keys());
    const links = [...active].filter((k) => !k.startsWith('geo:')).length;
    const next = nextToResolve(state, info, active, BULK_IMPORT.resolveConcurrency - links);
    if (next.length > 0) {
      next.forEach(resolveRow);
      return;
    }
    const geoBusy = [...active].some((k) => k.startsWith('geo:'));
    const geoRow = geoBusy ? null : nextGeo(state, active);
    if (geoRow) {
      resolveGeo(geoRow);
      return;
    }
    if (active.size === 0) {
      setRunning(false);
      const c = countQueue(state, info);
      setAnnouncement(`识别结束：可导入 ${c.importable} 行，需要处理 ${c.needsAttention} 行`);
    }
  }, [running, state, info, tick, resolveRow, resolveGeo]);

  const canRun = waitSeconds === 0;
  const start = useCallback(() => {
    if (!canRun) return;
    setPausedUntil(null);
    setRunning(true);
  }, [canRun]);
  const pause = useCallback(() => setRunning(false), []);

  const addPaste = useCallback(
    (text: string): PasteResult => {
      const result = parsePaste(text, stateRef.current.rows, newRowId);
      if (!result.ok) return result;
      setState((s) => ({ ...s, rows: [...s.rows, ...result.rows] }));
      setAnnouncement(`已加入 ${result.rows.length} 行`);
      if (canRun) setRunning(true);
      return result;
    },
    [canRun],
  );

  const actions = useMemo(
    () => ({
      edit: (id: string, edit: RowEdit) => setState((s) => guard((r) => editRow(r, edit))(s, id)),
      retry: (id: string) => {
        setState((s) => guard(retryRow)(s, id));
        if (canRun) setRunning(true);
      },
      retryAllFailed: () => {
        setState((s) => ({ ...s, rows: s.rows.map((r) => (isBulkRetryable(s, r) ? retryRow(r) : r)) }));
        if (canRun) setRunning(true);
      },
      setManual: (id: string, manual: boolean) => setState((s) => guard((r) => setManual(r, manual))(s, id)),
      editLocation: (id: string, field: LocationField, value: string) =>
        setState((s) => guard((r) => editRowLocation(r, field, value))(s, id)),
      setPurposes: (id: string, purposes: VenuePurpose[]) => setState((s) => guard((r) => setRowPurposes(r, purposes))(s, id)),
      setTreatTypes: (id: string, types: TreatType[]) => setState((s) => guard((r) => setRowTreatTypes(r, types))(s, id)),
      retryGeo: (id: string) => {
        setState((s) => guard(queueGeo)(s, id));
        if (canRun) setRunning(true);
      },
      retryFailedGeo: () => {
        setState((s) => ({ ...s, rows: s.rows.map((r) => (isGeoFailed(r) && !isLocked(s, r.id) ? queueGeo(r) : r)) }));
        if (canRun) setRunning(true);
      },
      toggle: (id: string, selected: boolean) => setState((s) => guard((r) => ({ ...r, selected }))(s, id)),
      selectAll: (selected: boolean) => setState((s) => ({ ...s, rows: selectImportable(s.rows, infoRef.current, selected) })),
      remove: (id: string) => {
        for (const key of [id, `geo:${id}`]) {
          inFlight.current.get(key)?.abort();
          inFlight.current.delete(key);
        }
        setState((s) => (isLocked(s, id) ? s : { ...s, rows: s.rows.filter((r) => r.id !== id) }));
      },
      clearImported: () => setState((s) => ({ ...s, rows: s.rows.filter((r) => r.status !== 'imported') })),
      clearAll: () => {
        for (const c of inFlight.current.values()) c.abort();
        inFlight.current.clear();
        setRunning(false);
        setOutcome(null);
        setState((s) => (s.pendingCommit ? { ...s, rows: s.rows.filter((r) => isLocked(s, r.id)) } : emptyQueue()));
      },
    }),
    [canRun],
  );

  const addBatchTags = useCallback((raw: string): BatchTagResult => {
    const result = addTagsToSelected(stateRef.current.rows, infoRef.current, raw);
    if (result.ok) {
      setState((s) => ({ ...s, rows: result.rows }));
      setAnnouncement(`已给 ${result.applied} 行添加标签${result.skipped ? `，${result.skipped} 行标签已满未修改` : ''}`);
    }
    return result;
  }, []);

  const fillLocation = useCallback((values: Partial<Record<LocationField, string>>, mode: 'empty' | 'replace'): BatchFillResult => {
    const result = fillLocationSelected(stateRef.current.rows, infoRef.current, values, mode);
    if (result.ok) {
      setState((s) => ({ ...s, rows: result.rows }));
      setAnnouncement(`已更新 ${result.applied} 行的地区${result.unchanged ? `，${result.unchanged} 行已有内容未修改` : ''}`);
    }
    return result;
  }, []);

  const fillPurposes = useCallback((purposes: VenuePurpose[]): BatchFillResult => {
    const result = setPurposesSelected(stateRef.current.rows, infoRef.current, purposes);
    if (result.ok) {
      setState((s) => ({ ...s, rows: result.rows }));
      setAnnouncement(`已设置 ${result.applied} 行的用途`);
    }
    return result;
  }, []);

  const fillTreatTypes = useCallback((types: TreatType[], mode: 'add' | 'replace'): BatchFillResult => {
    const result = setTreatTypesSelected(stateRef.current.rows, infoRef.current, types, mode);
    if (result.ok) {
      setState((s) => ({ ...s, rows: result.rows }));
      setAnnouncement(`已设置 ${result.applied} 行的类型${result.unchanged ? `，${result.unchanged} 行未修改` : ''}`);
    }
    return result;
  }, []);

  const refreshCatalog = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: RESTAURANTS_KEY });
    await queryClient.invalidateQueries({ queryKey: keys.catalog });
  }, [queryClient]);

  /** Sends the selection — or resends the unanswered batch with the same key and exact body. */
  const commit = useCallback(async () => {
    if (committing.current) return;
    let pending = stateRef.current.pendingCommit;
    if (!pending) {
      const rows = commitRows(stateRef.current, infoRef.current);
      if (rows.length === 0) return;
      pending = buildPendingCommit(rows, newIdempotencyKey());
      const next = { ...stateRef.current, pendingCommit: pending };
      saveBulkDraft(next); // on disk before the request leaves
      stateRef.current = next;
      setState(next);
    }
    const sent = pending;
    committing.current = true;
    setCommitBusy(true);
    setCommitError(null);
    setOutcome(null);
    const settle = (s: QueueState) => (s.pendingCommit?.key === sent.key ? null : s.pendingCommit);
    try {
      const res = await api<RestaurantImportResponse>('POST', '/admin/restaurants/import', {
        jsonText: sent.body,
        idempotencyKey: sent.key,
      });
      if (!mounted.current) return; // the draft still holds the batch; the next visit replays it
      setState((s) => ({ rows: applyCommitResults(s.rows, res), pendingCommit: settle(s) }));
      setOutcome({ created: res.created, duplicates: res.duplicates, errors: res.errors, replayed: res.replayed });
      setAnnouncement(`导入完成：新增 ${res.created} 家，跳过重复 ${res.duplicates} 行，${res.errors} 行需要修改`);
    } catch (err) {
      const unknown = !(err instanceof ApiError) || err.status === 0 || err.status >= 500;
      if (!mounted.current) return;
      if (!unknown) setState((s) => ({ ...s, pendingCommit: settle(s) }));
      const message = unknown
        ? '没有收到服务器的答复，可能已经导入了一部分。请点「重新提交」，同一批不会重复导入。'
        : errorText(err, '导入失败');
      setCommitError(message);
      setAnnouncement(message);
    } finally {
      committing.current = false;
      if (mounted.current) setCommitBusy(false);
      await refreshCatalog();
    }
  }, [refreshCatalog]);

  return {
    state,
    info,
    counts,
    restaurants,
    restored: initial.state !== null && initial.state.rows.length > 0,
    discarded: initial.discarded,
    storageOk,
    running,
    waitSeconds,
    paused: pausedUntil !== null,
    announcement,
    commitBusy,
    commitError,
    outcome,
    start,
    pause,
    addPaste,
    addBatchTags,
    fillLocation,
    fillPurposes,
    fillTreatTypes,
    withGeo,
    setWithGeo,
    geoFailed: state.rows.filter(isGeoFailed).length,
    commit,
    ...actions,
  };
}

export type BulkImport = ReturnType<typeof useBulkImport>;

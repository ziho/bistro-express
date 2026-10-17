import { BULK_IMPORT, LIMITS, MAP_LINK_INPUT_MAX } from '../../../shared/constants';
import type { RestaurantDuplicate } from '../../../shared/types';
import type { CommitIssue, PendingCommit, QueueRow, QueueState, RowPreview, RowStatus } from './bulkQueue';

/**
 * The bulk-import queue survives reloads in *this tab only* (sessionStorage): nothing is sent to
 * the server until 导入. Stored data is untrusted on the way back in — shape, sizes and version
 * are checked, and anything unexpected discards the draft instead of half-loading it.
 */
export const BULK_DRAFT_KEY = 'bx:bulk-import';
export const BULK_DRAFT_VERSION = 1;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;
const STATUSES: RowStatus[] = ['queued', 'resolving', 'resolved', 'failed', 'edited', 'imported'];
/** Generous caps: the editor allows any typing, the draft only refuses absurd sizes. */
const MAX_TEXT = 4 * MAP_LINK_INPUT_MAX;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const optStr = (v: unknown, max = MAX_TEXT) => v === undefined || str(v, max);

function readDuplicate(v: unknown): RestaurantDuplicate | null {
  if (!isObj(v) || !str(v.id, 64) || !str(v.name, 4 * LIMITS.name) || typeof v.active !== 'boolean') return null;
  if (!Array.isArray(v.matchedBy) || !v.matchedBy.every((m) => str(m, 40))) return null;
  return { id: v.id, name: v.name, active: v.active, matchedBy: v.matchedBy as string[] };
}

function readPreview(v: unknown): RowPreview | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !str(v.resolvedUrl) || !(v.mapUrl === null || str(v.mapUrl))) return undefined;
  if (typeof v.expanded !== 'boolean' || typeof v.hasPlace !== 'boolean') return undefined;
  if (!(v.nameSource === null || v.nameSource === 'place' || v.nameSource === 'query')) return undefined;
  return { resolvedUrl: v.resolvedUrl, mapUrl: v.mapUrl, expanded: v.expanded, nameSource: v.nameSource, hasPlace: v.hasPlace };
}

function readCommit(v: unknown): CommitIssue | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || !str(v.message, 500)) return undefined;
  if (v.kind === 'error') return { kind: 'error', message: v.message };
  if (v.kind !== 'duplicate' || !Array.isArray(v.duplicates) || v.duplicates.length > 50) return undefined;
  const duplicates = v.duplicates.map(readDuplicate);
  return duplicates.every(Boolean) ? { kind: 'duplicate', message: v.message, duplicates: duplicates as RestaurantDuplicate[] } : undefined;
}

function readRow(v: unknown): QueueRow | null {
  if (!isObj(v) || typeof v.id !== 'string' || !ID_RE.test(v.id)) return null;
  if (![v.line, v.sourceUrl, v.name, v.mapUrl, v.tags].every((s) => str(s))) return null;
  if (!STATUSES.includes(v.status as RowStatus) || !(v.error === null || str(v.error, 500))) return null;
  if (typeof v.manual !== 'boolean' || typeof v.selected !== 'boolean') return null;
  const auto = v.autofilled;
  if (!isObj(auto) || !optStr(auto.name) || !optStr(auto.mapUrl)) return null;
  const preview = readPreview(v.preview);
  const commit = readCommit(v.commit);
  if (preview === undefined || commit === undefined) return null;
  const imp = v.imported;
  if (!(imp === null || (isObj(imp) && str(imp.id, 64) && str(imp.name, 4 * LIMITS.name)))) return null;
  const imported = imp === null ? null : { id: imp.id as string, name: imp.name as string };
  if ((v.status === 'imported') !== (imported !== null)) return null;
  return {
    id: v.id,
    line: v.line as string,
    sourceUrl: v.sourceUrl as string,
    name: v.name as string,
    mapUrl: v.mapUrl as string,
    tags: v.tags as string,
    autofilled: { ...(auto.name !== undefined && { name: auto.name as string }), ...(auto.mapUrl !== undefined && { mapUrl: auto.mapUrl as string }) },
    // A preview cut off by the reload is simply waiting again.
    status: v.status === 'resolving' ? 'queued' : (v.status as RowStatus),
    error: v.error as string | null,
    preview,
    manual: v.manual,
    selected: v.selected,
    commit,
    imported,
  };
}

function readPending(v: unknown, ids: Set<string>): PendingCommit | null | undefined {
  if (v === null) return null;
  if (!isObj(v) || typeof v.key !== 'string' || !KEY_RE.test(v.key) || !str(v.body, BULK_IMPORT.requestBytes)) return undefined;
  if (!Array.isArray(v.rowIds) || v.rowIds.length > BULK_IMPORT.maxRows) return undefined;
  if (!v.rowIds.every((id) => typeof id === 'string' && ids.has(id))) return undefined;
  return { key: v.key, body: v.body, rowIds: v.rowIds as string[] };
}

/** Parses a stored draft; null when it is missing, from another version or malformed. */
export function parseBulkDraft(raw: string | null): QueueState | null {
  if (!raw || raw.length > 4 * 1024 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(value) || value.version !== BULK_DRAFT_VERSION || !Array.isArray(value.rows)) return null;
  if (value.rows.length > BULK_IMPORT.maxQueue) return null;
  const rows = value.rows.map(readRow);
  if (!rows.every(Boolean)) return null;
  const valid = rows as QueueRow[];
  const ids = new Set(valid.map((r) => r.id));
  if (ids.size !== valid.length) return null;
  const pendingCommit = readPending(value.pendingCommit, ids);
  if (pendingCommit === undefined) return null;
  return { rows: valid, pendingCommit };
}

export const serializeBulkDraft = (state: QueueState) =>
  JSON.stringify({ version: BULK_DRAFT_VERSION, savedAt: new Date().toISOString(), ...state });

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export type DraftLoad = { state: QueueState | null; discarded: boolean };

export function loadBulkDraft(): DraftLoad {
  try {
    const raw = storage()?.getItem(BULK_DRAFT_KEY) ?? null;
    if (raw === null) return { state: null, discarded: false };
    const state = parseBulkDraft(raw);
    if (!state) storage()?.removeItem(BULK_DRAFT_KEY);
    return { state, discarded: state === null };
  } catch {
    // Storage can fail at getItem/removeItem even when the sessionStorage getter succeeded.
    return { state: null, discarded: false };
  }
}

/** Returns false when the tab's storage refused the draft (full or disabled). */
export function saveBulkDraft(state: QueueState): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (state.rows.length === 0 && !state.pendingCommit) s.removeItem(BULK_DRAFT_KEY);
    else s.setItem(BULK_DRAFT_KEY, serializeBulkDraft(state));
    return true;
  } catch {
    return false;
  }
}

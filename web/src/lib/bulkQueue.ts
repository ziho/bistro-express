import { BULK_IMPORT, LIMITS, MAP_LINK_INPUT_MAX } from '../../../shared/constants';
import { findLinkDuplicates, linkKeys } from '../../../shared/mapsKeys';
import { classifyMapsUrl, extractLink, parseMapsUrl } from '../../../shared/mapsUrl';
import { splitTags } from '../../../shared/restaurant';
import type {
  MapLinkPreview,
  Restaurant,
  RestaurantDuplicate,
  RestaurantImportResponse,
  RestaurantImportRow,
} from '../../../shared/types';
import { mergeImport } from './mapImport';

/**
 * Pure state helpers of the admin bulk importer (批量导入). Every function returns new objects;
 * derived facts (duplicates, importability, selection) are recomputed from the rows each render so
 * they stay correct after edits, retries and removals.
 */

export type RowStatus = 'queued' | 'resolving' | 'resolved' | 'failed' | 'edited' | 'imported';

/** The part of a link preview the queue keeps (duplicates are recomputed against the latest list). */
export interface RowPreview {
  resolvedUrl: string;
  mapUrl: string | null;
  expanded: boolean;
  nameSource: MapLinkPreview['nameSource'];
  hasPlace: boolean;
}

export type CommitIssue =
  | { kind: 'error'; message: string }
  | { kind: 'duplicate'; message: string; duplicates: RestaurantDuplicate[] };

export interface QueueRow {
  /** Stable client id, also the import request's clientId. */
  id: string;
  /** The pasted line as it was (shown as text only). */
  line: string;
  sourceUrl: string;
  name: string;
  mapUrl: string;
  tags: string;
  /** Values the importer wrote, so a retry only replaces fields the admin has not touched. */
  autofilled: { name?: string; mapUrl?: string };
  status: RowStatus;
  error: string | null;
  preview: RowPreview | null;
  /** The admin explicitly chose to import a failed row with their own name and the strict link. */
  manual: boolean;
  selected: boolean;
  commit: CommitIssue | null;
  imported: { id: string; name: string } | null;
}

/** A submitted batch whose answer has not arrived yet: resent byte-for-byte with the same key. */
export interface PendingCommit {
  key: string;
  body: string;
  rowIds: string[];
}

export interface QueueState {
  rows: QueueRow[];
  pendingCommit: PendingCommit | null;
}

export const emptyQueue = (): QueueState => ({ rows: [], pendingCommit: null });

export const isLocked = (state: QueueState, id: string) => state.pendingCommit?.rowIds.includes(id) ?? false;

// ---------- Paste ----------

/** Why a pasted/edited source cannot be previewed, or null when it is a strict Google Maps link. */
export function sourceProblem(sourceUrl: string): string | null {
  if (!sourceUrl) return '这一行没有找到链接';
  if (sourceUrl.length > MAP_LINK_INPUT_MAX) return `链接太长（超过 ${MAP_LINK_INPUT_MAX} 个字符）`;
  const classified = classifyMapsUrl(sourceUrl);
  return classified.ok ? null : classified.reason;
}

export function newRow(line: string, id: string): QueueRow {
  const tooLong = line.length > MAP_LINK_INPUT_MAX;
  const sourceUrl = tooLong ? '' : (extractLink(line) ?? '');
  const problem = tooLong ? `这一行太长（超过 ${MAP_LINK_INPUT_MAX} 个字符）` : sourceProblem(sourceUrl);
  return {
    id,
    line,
    sourceUrl,
    name: '',
    mapUrl: '',
    tags: '',
    autofilled: {},
    status: problem ? 'failed' : 'queued',
    error: problem,
    preview: null,
    manual: false,
    selected: true,
    commit: null,
    imported: null,
  };
}

export type PasteResult = { ok: true; rows: QueueRow[] } | { ok: false; error: string };

/**
 * One line per link. Blank lines are skipped; every other line becomes a row — lines without a
 * usable link stay visible as failed rows. Too much text is rejected as a whole, never truncated.
 */
export function parsePaste(text: string, current: QueueRow[], makeId: () => string): PasteResult {
  if (text.length > BULK_IMPORT.maxPasteChars) {
    return { ok: false, error: `粘贴的内容太长（${text.length} 个字符，上限 ${BULK_IMPORT.maxPasteChars}），请分批粘贴` };
  }
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { ok: false, error: '没有找到内容，请每行粘贴一个 Google 地图链接' };
  if (lines.length > BULK_IMPORT.maxRows) {
    return { ok: false, error: `一次最多粘贴 ${BULK_IMPORT.maxRows} 行，这次有 ${lines.length} 行，请分批粘贴` };
  }
  const longLine = lines.findIndex((line) => line.length > MAP_LINK_INPUT_MAX);
  if (longLine >= 0) {
    return { ok: false, error: '第 ' + (longLine + 1) + ' 行超过 ' + MAP_LINK_INPUT_MAX + ' 个字符，请缩短后再加入；原文仍保留在输入框。' };
  }
  const active = current.filter((r) => r.status !== 'imported').length;
  if (active + lines.length > BULK_IMPORT.maxRows) {
    return {
      ok: false,
      error: `队列里最多 ${BULK_IMPORT.maxRows} 行待导入，现在有 ${active} 行，这次的 ${lines.length} 行放不下。请先导入或删除一些`,
    };
  }
  if (current.length + lines.length > BULK_IMPORT.maxQueue) {
    return { ok: false, error: '队列太长了，请先点「清除已导入」' };
  }
  return { ok: true, rows: lines.map((line) => newRow(line, makeId())) };
}

// ---------- Row updates ----------

export type RowEdit = Partial<Pick<QueueRow, 'name' | 'mapUrl' | 'tags' | 'sourceUrl'>>;

/** Admin edits. A changed source link needs a new preview; any edit clears the last import verdict. */
export function editRow(row: QueueRow, edit: RowEdit): QueueRow {
  if (row.status === 'imported') return row;
  const next: QueueRow = { ...row, ...edit, commit: null };
  if (edit.sourceUrl !== undefined && edit.sourceUrl !== row.sourceUrl) {
    // Changing the source chooses a new place: discard its old destination and untouched auto-name.
    return {
      ...next,
      mapUrl: edit.mapUrl ?? '',
      name: edit.name ?? (row.name === row.autofilled.name ? '' : row.name),
      autofilled: {},
      status: 'edited',
      error: null,
      preview: null,
      manual: false,
    };
  }
  if (edit.mapUrl !== undefined && edit.mapUrl !== row.mapUrl) {
    // A manually changed destination must be checked on its own; old source/preview keys cannot follow it.
    return { ...next, sourceUrl: edit.mapUrl.trim(), status: 'edited', error: null, preview: null, manual: false };
  }
  return next;
}

export function retryRow(row: QueueRow): QueueRow {
  if (row.status === 'imported' || row.status === 'resolving') return row;
  const problem = sourceProblem(row.sourceUrl);
  return { ...row, status: problem ? 'failed' : 'queued', error: problem, manual: false, commit: null };
}

export const isRetryable = (row: QueueRow) => row.status === 'failed' || row.status === 'edited';

export function markResolving(row: QueueRow): QueueRow {
  return row.status === 'queued' ? { ...row, status: 'resolving', error: null } : row;
}

/**
 * A preview arrived. Applied only if the row is still waiting for exactly this link; fills the
 * name/map link only when empty or still holding the importer's earlier value. Tags are never touched.
 */
export function applyPreview(row: QueueRow, sent: string, preview: MapLinkPreview): QueueRow {
  if (row.status !== 'resolving' || row.sourceUrl !== sent) return row;
  const merged = mergeImport({ name: row.name, mapUrl: row.mapUrl }, row.autofilled, { name: preview.name, mapUrl: preview.mapUrl });
  return {
    ...row,
    ...merged.updates,
    autofilled: merged.autofilled,
    status: 'resolved',
    error: null,
    manual: false,
    preview: {
      resolvedUrl: preview.resolvedUrl,
      mapUrl: preview.mapUrl,
      expanded: preview.expanded,
      nameSource: preview.nameSource,
      hasPlace: preview.place !== null,
    },
  };
}

export function applyFailure(row: QueueRow, sent: string, message: string): QueueRow {
  if (row.status !== 'resolving' || row.sourceUrl !== sent) return row;
  return { ...row, status: 'failed', error: message, preview: null };
}

/** Rate limited: put the row back in line untouched, to be continued by the admin later. */
export function requeue(row: QueueRow, sent: string): QueueRow {
  if (row.status !== 'resolving' || row.sourceUrl !== sent) return row;
  return { ...row, status: 'queued' };
}

/** Explicit fallback after a failed preview: the strict Google link becomes the map link. */
export function setManual(row: QueueRow, manual: boolean): QueueRow {
  if (row.status !== 'failed') return row;
  if (!manual) return { ...row, manual: false };
  return { ...row, manual: true, mapUrl: row.mapUrl.trim() ? row.mapUrl : row.sourceUrl, commit: null };
}

// ---------- Derived facts ----------

export interface RowProblem {
  field: 'name' | 'mapUrl' | 'tags';
  message: string;
}

export interface RowInfo {
  /** 1-based position, as shown to the admin. */
  index: number;
  existing: RestaurantDuplicate[];
  /** An earlier row in the queue pointing at the same place. */
  queueDuplicateOf: { id: string; index: number } | null;
  problems: RowProblem[];
  /** The failed row may be imported manually (strict Google link that fits the map link field). */
  canManual: boolean;
  importable: boolean;
  selected: boolean;
}

/** The canonical form the server will store, for the length check. */
function canonicalMapUrl(raw: string): string | null {
  const c = classifyMapsUrl(raw);
  if (!c.ok) return null;
  return c.kind === 'maps' ? parseMapsUrl(c.url).cleanUrl : raw;
}

/**
 * Same field rules as the ordinary restaurant form and restaurantInputSchema (lengths in UTF-16
 * units, as the server counts them).
 */
export function rowProblems(row: QueueRow): RowProblem[] {
  const problems: RowProblem[] = [];
  const name = row.name.trim();
  if (!name) problems.push({ field: 'name', message: '请填写店名' });
  else if (name.length > LIMITS.name) problems.push({ field: 'name', message: `店名不能超过 ${LIMITS.name} 个字` });
  const mapUrl = row.mapUrl.trim();
  const classified = classifyMapsUrl(mapUrl);
  if (!mapUrl) problems.push({ field: 'mapUrl', message: '缺少地图链接' });
  else if (!classified.ok) problems.push({ field: 'mapUrl', message: `地图链接：${classified.reason}` });
  else if ((canonicalMapUrl(mapUrl) ?? mapUrl).length > LIMITS.url) {
    problems.push({ field: 'mapUrl', message: `地图链接不能超过 ${LIMITS.url} 个字符` });
  }
  for (const message of tagProblems(splitTags(row.tags))) problems.push({ field: 'tags', message });
  return problems;
}

export function tagProblems(tags: string[]): string[] {
  const problems: string[] = [];
  if (tags.length > LIMITS.tags) problems.push(`最多 ${LIMITS.tags} 个标签`);
  const long = tags.find((t) => t.length > LIMITS.tag);
  if (long) problems.push(`标签「${long}」超过 ${LIMITS.tag} 个字`);
  return problems;
}

export function rowKeys(row: QueueRow): Set<string> {
  return linkKeys([row.sourceUrl, row.mapUrl.trim(), row.preview?.resolvedUrl]);
}

/**
 * Duplicates against existing restaurants (incl. inactive) and earlier queue rows, by links and
 * place identifiers only — never by name. `restaurants` null = list not loaded, nothing importable.
 */
export function analyzeQueue(state: QueueState, restaurants: Restaurant[] | null): Map<string, RowInfo> {
  const info = new Map<string, RowInfo>();
  const firstByKey = new Map<string, { id: string; index: number; importedId: string | null }>();
  state.rows.forEach((row, i) => {
    const index = i + 1;
    const keys = rowKeys(row);
    let anchor: { id: string; index: number; importedId: string | null } | null = null;
    for (const key of keys) {
      anchor ??= firstByKey.get(key) ?? null;
      if (!firstByKey.has(key)) firstByKey.set(key, { id: row.id, index, importedId: row.imported?.id ?? null });
    }
    if (row.status === 'imported') {
      info.set(row.id, { index, existing: [], queueDuplicateOf: null, problems: [], canManual: false, importable: false, selected: false });
      return;
    }
    const existing = restaurants ? findLinkDuplicates(keys, restaurants) : [];
    // An imported row that already shows up in the refreshed list is reported once, as existing.
    const queueDuplicateOf = anchor && !existing.some((d) => d.id === anchor.importedId) ? { id: anchor.id, index: anchor.index } : null;
    const problems = rowProblems(row);
    const canManual = row.status === 'failed' && sourceProblem(row.sourceUrl) === null && row.sourceUrl.length <= LIMITS.url;
    const ready = row.status === 'resolved' || (row.status === 'failed' && row.manual && canManual);
    const importable =
      restaurants !== null &&
      ready &&
      !isLocked(state, row.id) &&
      problems.length === 0 &&
      existing.length === 0 &&
      queueDuplicateOf === null &&
      row.commit === null;
    info.set(row.id, { index, existing, queueDuplicateOf, problems, canManual, importable, selected: importable && row.selected });
  });
  return info;
}

export interface QueueCounts {
  total: number;
  imported: number;
  waiting: number;
  /** Failed or edited previews that 「重试全部失败」 would send again. */
  failed: number;
  needsAttention: number;
  duplicates: number;
  importable: number;
  selected: number;
}

export type RowGroup = 'imported' | 'duplicate' | 'waiting' | 'attention' | 'importable' | 'other';

const isDuplicate = (row: QueueRow, i: RowInfo | undefined) =>
  !!i && (i.existing.length > 0 || i.queueDuplicateOf !== null || row.commit?.kind === 'duplicate');

/** The filter group a row is listed under (the same rules as the counts). */
export function rowGroup(row: QueueRow, i: RowInfo | undefined): RowGroup {
  if (row.status === 'imported') return 'imported';
  if (isDuplicate(row, i)) return 'duplicate';
  if (row.status === 'queued' || row.status === 'resolving') return 'waiting';
  if (i?.importable) return 'importable';
  if (isRetryable(row) || row.commit?.kind === 'error' || (row.status === 'resolved' && !!i?.problems.length)) return 'attention';
  return 'other';
}

/** Rows 「重试全部失败」 sends again; a row the admin chose to import manually is left alone. */
export const isBulkRetryable = (state: QueueState, row: QueueRow) => isRetryable(row) && !row.manual && !isLocked(state, row.id);

export function countQueue(state: QueueState, info: Map<string, RowInfo>): QueueCounts {
  const counts: QueueCounts = {
    total: state.rows.length,
    imported: 0,
    waiting: 0,
    failed: 0,
    needsAttention: 0,
    duplicates: 0,
    importable: 0,
    selected: 0,
  };
  for (const row of state.rows) {
    const i = info.get(row.id);
    const group = rowGroup(row, i);
    if (group === 'imported') counts.imported += 1;
    if (group === 'waiting') counts.waiting += 1;
    if (group === 'attention') counts.needsAttention += 1;
    if (group === 'duplicate') counts.duplicates += 1;
    if (isBulkRetryable(state, row)) counts.failed += 1;
    if (i?.importable) counts.importable += 1;
    if (i?.selected) counts.selected += 1;
  }
  return counts;
}

/** Rows the runner may preview next: queued, and not already a copy of an earlier row. */
export function nextToResolve(state: QueueState, info: Map<string, RowInfo>, busy: Set<string>, slots: number): QueueRow[] {
  if (slots <= 0) return [];
  return state.rows.filter((r) => r.status === 'queued' && !busy.has(r.id) && !info.get(r.id)?.queueDuplicateOf && !info.get(r.id)?.existing.length).slice(0, slots);
}

// ---------- Selection and batch tags ----------

export function selectImportable(rows: QueueRow[], info: Map<string, RowInfo>, selected: boolean): QueueRow[] {
  return rows.map((r) => (info.get(r.id)?.importable ? { ...r, selected } : r));
}

export type BatchTagResult = { ok: true; rows: QueueRow[]; applied: number; skipped: number } | { ok: false; error: string };

/** Adds tags (union, de-duplicated) to the selected importable rows only. */
export function addTagsToSelected(rows: QueueRow[], info: Map<string, RowInfo>, raw: string): BatchTagResult {
  const incoming = splitTags(raw);
  if (incoming.length === 0) return { ok: false, error: '请先输入要添加的标签' };
  const problems = tagProblems(incoming);
  if (problems.length) return { ok: false, error: problems.join('；') };
  let applied = 0;
  let skipped = 0;
  const next = rows.map((r) => {
    if (!info.get(r.id)?.selected) return r;
    const merged = [...new Set([...splitTags(r.tags), ...incoming])];
    if (merged.length > LIMITS.tags) {
      skipped += 1;
      return r;
    }
    applied += 1;
    return { ...r, tags: merged.join(' ') };
  });
  if (applied + skipped === 0) return { ok: false, error: '还没有选中可导入的行' };
  return { ok: true, rows: next, applied, skipped };
}

// ---------- Commit ----------

export function commitRows(state: QueueState, info: Map<string, RowInfo>): RestaurantImportRow[] {
  return state.rows
    .filter((r) => info.get(r.id)?.selected)
    .slice(0, BULK_IMPORT.maxRows)
    .map((r) => ({
      clientId: r.id,
      name: r.name.trim(),
      mapUrl: r.mapUrl.trim(),
      sourceUrl: r.sourceUrl || null,
      tags: splitTags(r.tags),
    }));
}

export function buildPendingCommit(rows: RestaurantImportRow[], key: string): PendingCommit {
  return { key, body: JSON.stringify({ rows }), rowIds: rows.map((r) => r.clientId) };
}

/** Created rows become read-only; duplicates and errors stay editable for another try. */
export function applyCommitResults(rows: QueueRow[], response: RestaurantImportResponse): QueueRow[] {
  const byId = new Map(response.results.map((r) => [r.clientId, r]));
  return rows.map((row) => {
    const result = byId.get(row.id);
    if (!result || row.status === 'imported') return row;
    if (result.status === 'created') {
      return { ...row, status: 'imported', selected: false, commit: null, imported: result.restaurant };
    }
    if (result.status === 'duplicate') {
      return { ...row, selected: false, commit: { kind: 'duplicate', message: result.message, duplicates: result.duplicates } };
    }
    return { ...row, commit: { kind: 'error', message: result.message } };
  });
}

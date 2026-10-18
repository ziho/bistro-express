import { BULK_IMPORT, LIMITS, MAP_LINK_INPUT_MAX } from '../../../shared/constants';
import { splitTags } from '../../../shared/restaurant';
import { mergeLegacyVenueTags } from '../../../shared/venueTags';
import { isTreatType, normalizeTreatTypes, TREAT_TYPES } from '../../../shared/treatType';
import type { RestaurantDuplicate, TreatType, VenuePurpose } from '../../../shared/types';
import { isCountryCode, normalizePurposes, VENUE_PURPOSES } from '../../../shared/venue';
import { idleGeo, type CommitIssue, type GeoStatus, type PendingCommit, type QueueRow, type QueueState, type RowGeo, type RowPreview, type RowStatus } from './bulkQueue';
import { LOCATION_FIELDS, toLocationForm, type LocationFormState } from './venueForm';

/**
 * The bulk-import queue survives reloads in *this tab only* (sessionStorage): nothing is sent to
 * the server until 导入. Stored data is untrusted on the way back in — shape, sizes and version
 * are checked, and anything unexpected discards the draft instead of half-loading it.
 */
export const BULK_DRAFT_KEY = 'bx:bulk-import';
/**
 * 2 = location / entry; 3 = legacy dessert types; 4 = one classification tag list.
 * Older drafts are still read: their rows get an unknown location, ['meal'] and no types (未分类),
 * Legacy type choices are folded into editable tags. An unanswered batch keeps its exact body
 * and key (it is resent byte-for-byte), including any legacy type field.
 */
export const BULK_DRAFT_VERSION = 4;
const READABLE_VERSIONS = new Set([1, 2, 3, 4]);

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
  const location = readLocation(v.location);
  const purposes = readPurposes(v.purposes);
  const treatTypes = readTreatTypes(v.treatTypes);
  const geo = readGeo(v.geo);
  if (!location || !purposes || !treatTypes || !geo) return null;
  return {
    id: v.id,
    line: v.line as string,
    sourceUrl: v.sourceUrl as string,
    name: v.name as string,
    mapUrl: v.mapUrl as string,
    tags: treatTypes.length ? mergeLegacyVenueTags(splitTags(v.tags as string), treatTypes).join(' ') : v.tags as string,
    location,
    purposes,
    treatTypes: [],
    geo,
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

const GEO_STATUSES: GeoStatus[] = ['idle', 'queued', 'pending', 'suggested', 'no_point', 'not_found', 'unavailable', 'disabled'];

/** Undefined = malformed. */
function readLocation(v: unknown): LocationFormState | undefined {
  if (v === undefined) return toLocationForm(null);
  if (!isObj(v) || !isObj(v.values) || !isObj(v.autofilled) || !isObj(v.codes)) return undefined;
  const values = v.values;
  const auto = v.autofilled;
  if (!LOCATION_FIELDS.every((f) => str(values[f], 400) && optStr(auto[f], 400))) return undefined;
  const codes = Object.entries(v.codes);
  if (codes.length > 20 || !codes.every(([k, c]) => k.length <= 400 && typeof c === 'string' && isCountryCode(c))) return undefined;
  return {
    values: { country: values.country as string, region: values.region as string, city: values.city as string },
    autofilled: Object.fromEntries(LOCATION_FIELDS.flatMap((f) => (auto[f] === undefined ? [] : [[f, auto[f] as string]]))),
    codes: Object.fromEntries(codes) as Record<string, string>,
  };
}

function readPurposes(v: unknown): VenuePurpose[] | undefined {
  if (v === undefined) return ['meal'];
  if (!Array.isArray(v) || v.length > 4 || !v.every((p) => VENUE_PURPOSES.includes(p as VenuePurpose))) return undefined;
  return normalizePurposes(v);
}

/** Missing (drafts before version 3) = no types; anything but a short list of known types is malformed. */
function readTreatTypes(v: unknown): TreatType[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > TREAT_TYPES.length || !v.every(isTreatType)) return undefined;
  return normalizeTreatTypes(v);
}

function readGeo(v: unknown): RowGeo | undefined {
  if (v === undefined) return idleGeo();
  if (!isObj(v) || !GEO_STATUSES.includes(v.status as GeoStatus)) return undefined;
  if (!(v.message === null || str(v.message, 500)) || !(v.url === null || str(v.url))) return undefined;
  // A lookup cut off by the reload waits again (it only runs when the admin continues).
  const status = v.status === 'pending' ? 'queued' : (v.status as GeoStatus);
  return { status, message: v.message as string | null, url: v.url as string | null };
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
  if (!isObj(value) || !READABLE_VERSIONS.has(value.version as number) || !Array.isArray(value.rows)) return null;
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

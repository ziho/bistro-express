import type { PlanInput, PlanMode, VenuePurpose } from '../../../shared/types';

/** Local-only meal drafts. Never synced; cleared on successful save and on logout. */
export interface Draft {
  key: string;
  planId: string | null;
  baseVersion: number | null;
  date: string;
  mealLabel: string;
  localTime: string;
  timeZone: string;
  mode: PlanMode;
  /** 'treat' = 喝点 / 吃点甜的 (restaurant mode only). Drafts saved before it existed are meals. */
  purpose: VenuePurpose;
  /** Saved by an older version (no purpose): a meal purpose is left out of the request, as before. */
  legacyBody?: true;
  note: string;
  dishIds: string[];
  candidateIds: string[];
  /** Restaurant chosen by the draw (or the single candidate). Cleared when candidates change. */
  selectedRestaurantId: string | null;
  sourcePlanId: string | null;
  /** Idempotency key reused while retrying the exact same submission. */
  pending: { key: string; fingerprint: string } | null;
  updatedAt: string;
}

const PREFIX = 'bx:draft:';
const LOCAL_PREFIX = 'bx:';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function newDraftKey(): string {
  return `new-${crypto.randomUUID()}`;
}

export const editDraftKey = (planId: string) => `edit-${planId}`;

export function emptyDraft(key: string, date: string): Draft {
  return {
    key,
    planId: null,
    baseVersion: null,
    date,
    mealLabel: '',
    localTime: '',
    timeZone: viewerTimeZone(),
    mode: 'home',
    purpose: 'meal',
    note: '',
    dishIds: [],
    candidateIds: [],
    selectedRestaurantId: null,
    sourcePlanId: null,
    pending: null,
    updatedAt: new Date().toISOString(),
  };
}

export function loadDraft(key: string): Draft | null {
  const raw = storage()?.getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed || parsed.key !== key) return null;
    const purpose: VenuePurpose = parsed.purpose === 'treat' ? 'treat' : 'meal';
    // A draft from before purposes existed keeps sending its old body shape, so a retry of its
    // pending submission still matches the original request (same idempotency fingerprint).
    const legacy = parsed.purpose === undefined || parsed.legacyBody === true;
    return { ...parsed, purpose, ...(legacy ? { legacyBody: true } : {}) };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    storage()?.setItem(PREFIX + draft.key, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
  } catch {
    // Storage full or disabled — drafts are best effort.
  }
}

export function deleteDraft(key: string): void {
  storage()?.removeItem(PREFIX + key);
}

export function listDrafts(): Draft[] {
  const s = storage();
  if (!s) return [];
  const drafts: Draft[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    const d = loadDraft(k.slice(PREFIX.length));
    if (d) drafts.push(d);
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Logout: wipe every local Bistro key (drafts and UI prefs). */
export function clearAllLocalData(): void {
  const s = storage();
  if (!s) return;
  const doomed: string[] = [];
  for (let i = 0; i < s.length; i += 1) {
    const k = s.key(i);
    if (k?.startsWith(LOCAL_PREFIX)) doomed.push(k);
  }
  for (const k of doomed) s.removeItem(k);
}

export function draftToInput(d: Draft): PlanInput {
  const purpose: VenuePurpose = d.mode === 'restaurant' ? d.purpose : 'meal';
  return {
    date: d.date,
    mealLabel: d.mealLabel.trim(),
    localTime: d.localTime || null,
    timeZone: d.timeZone,
    mode: d.mode,
    ...(d.legacyBody && purpose === 'meal' ? {} : { purpose }),
    note: d.note.trim(),
    dishIds: d.mode === 'home' ? d.dishIds : [],
    candidateIds: d.mode === 'restaurant' ? d.candidateIds : [],
    selectedRestaurantId: d.mode === 'restaurant' ? d.selectedRestaurantId : null,
    sourcePlanId: d.sourcePlanId,
  };
}

export function draftHasContent(d: Draft): boolean {
  return Boolean(d.mealLabel || d.note || d.dishIds.length || d.candidateIds.length || d.localTime);
}

import { isPastDate, isValidDateString, isValidTimeZone, resolveLocalDateTime, TIME_ERROR_MESSAGES } from '../../../shared/time';
import type { Catalog, Restaurant } from '../../../shared/types';
import { PURPOSE_LABEL } from '../../../shared/venue';
import { clampEditorStep, type Draft, type EditorStep } from './drafts';
import { drawableCandidates } from './outing';

/**
 * Pure rules of the three-step editor (定个日子 → 挑菜挑店 → 备注与确认): which step a draft may
 * enter, where a blocked submission should send the user, and how the candidate basket keeps its
 * final choice. No DOM and no React, so every gate is unit-tested.
 */

export type { EditorStep } from './drafts';
export const EDITOR_STEPS: readonly EditorStep[] = [1, 2, 3];
export const STEP_TITLE: Record<EditorStep, string> = { 1: '定个日子', 2: '挑菜挑店', 3: '备注与确认' };

export type MetaField = 'date' | 'mealLabel' | 'localTime' | 'timeZone';
export type MetaErrors = Partial<Record<MetaField, string>>;

/** Display order (and focus order) of step 1's fields. */
export const META_FIELD_ORDER: readonly MetaField[] = ['date', 'mealLabel', 'localTime', 'timeZone'];

/** Where the editor opens: an existing step wins; otherwise a saved plan opens on review. */
export function resumeStep(draft: Pick<Draft, 'editorStep' | 'planId'>): EditorStep {
  return clampEditorStep(draft.editorStep) ?? (draft.planId ? 3 : 1);
}

/** The local time problem of a draft, using the plan's own zone (DST gaps are rejected). */
export function timeProblem(draft: Pick<Draft, 'date' | 'localTime' | 'timeZone'>): string | null {
  if (!draft.localTime) return null;
  const r = resolveLocalDateTime(draft.date, draft.localTime, draft.timeZone);
  return r.ok ? null : TIME_ERROR_MESSAGES[r.reason];
}

export function timeIsAmbiguous(draft: Pick<Draft, 'date' | 'localTime' | 'timeZone'>): boolean {
  if (!draft.localTime) return false;
  const r = resolveLocalDateTime(draft.date, draft.localTime, draft.timeZone);
  return r.ok && r.ambiguous;
}

/** Step 1 gate, mirroring the server's checks (past date in the plan's zone, invalid zone or time). */
export function metaErrors(draft: Draft, now: Date = new Date()): MetaErrors {
  const errors: MetaErrors = {};
  if (!isValidDateString(draft.date)) errors.date = '请选一个日期';
  else if (isPastDate(draft.date, draft.timeZone, now)) errors.date = '不能安排已经过去的日期';
  if (!draft.mealLabel.trim()) errors.mealLabel = '给这一餐起个名字，比如「晚餐」';
  if (!isValidTimeZone(draft.timeZone)) errors.timeZone = TIME_ERROR_MESSAGES.invalid_zone;
  else {
    const tp = timeProblem(draft);
    if (tp) errors.localTime = tp;
  }
  return errors;
}

export function firstMetaError(errors: MetaErrors): MetaField | null {
  return META_FIELD_ORDER.find((f) => errors[f]) ?? null;
}

export type SelectionIssueCode = 'empty' | 'unavailable' | 'incompatible' | 'needs_choice';
export interface SelectionIssue {
  code: SelectionIssueCode;
  message: string;
}

export type CandidateState = 'ok' | 'unavailable' | 'incompatible';

/** Why a basket entry cannot be used: gone from the active catalog, or not serving this outing. */
export function candidateState(id: string, restaurants: readonly Restaurant[], purpose: Draft['purpose']): CandidateState {
  const r = restaurants.find((x) => x.id === id);
  if (!r || !r.active) return 'unavailable';
  return r.purposes.includes(purpose) ? 'ok' : 'incompatible';
}

export function dishAvailable(id: string, catalog: Catalog): boolean {
  return catalog.dishes.some((d) => d.id === id && d.active);
}

/** Step 2 gate: valid available dishes, or compatible candidates plus one final venue among them. */
export function selectionIssue(draft: Draft, catalog: Catalog): SelectionIssue | null {
  if (draft.mode === 'home') {
    if (draft.dishIds.length === 0) return { code: 'empty', message: '至少选一道菜' };
    if (draft.dishIds.some((id) => !dishAvailable(id, catalog))) return { code: 'unavailable', message: '有菜已经下架，请先移除' };
    return null;
  }
  if (draft.candidateIds.length === 0) return { code: 'empty', message: '至少加入一家候选店' };
  const states = draft.candidateIds.map((id) => candidateState(id, catalog.restaurants, draft.purpose));
  if (states.includes('unavailable')) return { code: 'unavailable', message: '有店已经下架，请先移除' };
  if (states.includes('incompatible')) {
    return { code: 'incompatible', message: `有店不适合「${PURPOSE_LABEL[draft.purpose]}」，请先移除` };
  }
  if (!draft.selectedRestaurantId || !draft.candidateIds.includes(draft.selectedRestaurantId)) {
    return { code: 'needs_choice', message: '随机抽一家，或者直接选定一家' };
  }
  return null;
}

export type StepCheck =
  | { ok: true }
  | { ok: false; step: 1; fields: MetaErrors; message: string }
  | { ok: false; step: 2; issue: SelectionIssue; message: string };

/** Everything that must hold before `target` can be shown (step 3 = everything, used on submit too). */
export function checkBefore(target: EditorStep, draft: Draft, catalog: Catalog, now: Date = new Date()): StepCheck {
  if (target === 1) return { ok: true };
  const fields = metaErrors(draft, now);
  const first = firstMetaError(fields);
  if (first) return { ok: false, step: 1, fields, message: fields[first]! };
  if (target === 2) return { ok: true };
  const issue = selectionIssue(draft, catalog);
  return issue ? { ok: false, step: 2, issue, message: issue.message } : { ok: true };
}

/** A submit rejected by the server: the step that holds the fix (null = no step to revisit). */
export function stepForServerError(code: string, field?: unknown): EditorStep | null {
  if (['past_date', 'invalid_time', 'nonexistent_time'].includes(code)) return 1;
  if (['unavailable_items', 'incompatible_purpose', 'invalid_selection', 'no_items'].includes(code)) return 2;
  if (code === 'invalid_request' && (field === 'date' || field === 'timeZone' || field === 'localTime' || field === 'mealLabel')) return 1;
  return null;
}

/** The only candidate that may become the final venue without a draw, if there is exactly one. */
export function soleChoice(draft: Pick<Draft, 'candidateIds' | 'purpose'>, catalog: Catalog): string | null {
  const drawable = drawableCandidates(draft.candidateIds, catalog.restaurants, draft.purpose);
  return drawable.length === 1 ? drawable[0]! : null;
}

/**
 * New basket → new final venue: a previous draw no longer counts, except that a basket with a
 * single usable candidate settles on it straight away.
 */
export function withCandidates(draft: Draft, catalog: Catalog, candidateIds: string[]): Pick<Draft, 'candidateIds' | 'selectedRestaurantId'> {
  return { candidateIds, selectedRestaurantId: soleChoice({ candidateIds, purpose: draft.purpose }, catalog) };
}

/**
 * Restored or catalog-refreshed drafts with no final venue in the basket: settle on the sole usable
 * candidate. An existing choice is never replaced here (an unusable one is flagged, not swapped).
 */
export function autoChoicePatch(draft: Draft, catalog: Catalog): Pick<Draft, 'selectedRestaurantId'> | null {
  if (draft.mode !== 'restaurant') return null;
  if (draft.selectedRestaurantId && draft.candidateIds.includes(draft.selectedRestaurantId)) return null;
  const sole = soleChoice(draft, catalog);
  return sole ? { selectedRestaurantId: sole } : null;
}

/** Choosing directly from the summary: only a usable candidate in the basket can be chosen. */
export function choosePatch(draft: Draft, catalog: Catalog, id: string): Pick<Draft, 'selectedRestaurantId'> | null {
  return drawableCandidates(draft.candidateIds, catalog.restaurants, draft.purpose).includes(id) ? { selectedRestaurantId: id } : null;
}

/** Identity of the basket a draw was started for; any change makes a pending draw stale. */
export function basketSignature(draft: Pick<Draft, 'mode' | 'purpose' | 'candidateIds'>): string {
  return JSON.stringify([draft.mode, draft.purpose, draft.candidateIds]);
}

/** A delayed draw lands only if the basket is still the one it was started for. */
export function drawCommit(startedFor: string, current: Draft, picked: string | null): Pick<Draft, 'selectedRestaurantId'> | null {
  if (picked === null || basketSignature(current) !== startedFor) return null;
  return current.candidateIds.includes(picked) ? { selectedRestaurantId: picked } : null;
}

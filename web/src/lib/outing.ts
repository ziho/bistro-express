import type { Restaurant, VenuePurpose } from '../../../shared/types';
import { outingFromKind, outingKind, TREAT_DEFAULT_LABEL, type OutingKind } from '../../../shared/venue';
import type { Draft } from './drafts';

/**
 * Pure helpers for switching a draft between 在家吃 / 去吃饭 / 饮品甜品. Dishes and candidates stay
 * in the draft across home ↔ restaurant (as before); only venues that do not fit the new purpose
 * are ever removed, and only after the user confirmed it (see incompatibleCandidates).
 */

export const draftOuting = (d: Pick<Draft, 'mode' | 'purpose'>): OutingKind => outingKind(d);

/** Candidate ids whose (current catalog) venue does not serve `purpose`. Unknown ids are left alone. */
export function incompatibleCandidates(candidateIds: readonly string[], restaurants: readonly Restaurant[], purpose: VenuePurpose): string[] {
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  return candidateIds.filter((id) => {
    const r = byId.get(id);
    return r !== undefined && !r.purposes.includes(purpose);
  });
}

/** Candidates that may be drawn for `purpose`: known, active and serving that purpose. */
export function drawableCandidates(candidateIds: readonly string[], restaurants: readonly Restaurant[], purpose: VenuePurpose): string[] {
  const ok = new Set(restaurants.filter((r) => r.active && r.purposes.includes(purpose)).map((r) => r.id));
  return [...new Set(candidateIds)].filter((id) => ok.has(id));
}

/**
 * The draft after choosing another outing. `drop` lists candidates the user agreed to remove;
 * a dropped selected venue is cleared. A treat outing is named 下午茶 only while the label is empty.
 */
export function withOuting(draft: Draft, kind: OutingKind, drop: readonly string[] = []): Draft {
  const { mode, purpose } = outingFromKind(kind);
  const removed = new Set(drop);
  const candidateIds = draft.candidateIds.filter((id) => !removed.has(id));
  const selectedRestaurantId = draft.selectedRestaurantId && removed.has(draft.selectedRestaurantId) ? null : draft.selectedRestaurantId;
  const mealLabel = kind === 'treat' && !draft.mealLabel.trim() ? TREAT_DEFAULT_LABEL : draft.mealLabel;
  // Home plans are always meals; the restaurant purpose is remembered while cooking at home.
  return { ...draft, mode, purpose: mode === 'home' ? draft.purpose : purpose, candidateIds, selectedRestaurantId, mealLabel };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, Dish, Restaurant } from '../shared/types';
import { clampEditorStep, draftToInput, emptyDraft, loadDraft, saveDraft, type Draft } from '../web/src/lib/drafts';
import {
  autoChoicePatch,
  basketSignature,
  checkBefore,
  choosePatch,
  drawCommit,
  firstMetaError,
  metaErrors,
  resumeStep,
  selectionIssue,
  stepForServerError,
  withCandidates,
} from '../web/src/lib/editorFlow';
import { withOuting } from '../web/src/lib/outing';

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date('2030-01-01T12:00:00Z');
const ZONE = 'America/New_York';

const dish = (id: string, active = true) => ({ id, name: `菜 ${id}`, active }) as Dish;
const venue = (id: string, purposes: Restaurant['purposes'], active = true) => ({ id, name: `店 ${id}`, purposes, active }) as Restaurant;

const catalog: Catalog = {
  dishes: [dish('d1'), dish('d2'), dish('gone', false)],
  restaurants: [venue('r1', ['meal']), venue('r2', ['meal']), venue('both', ['meal', 'treat']), venue('cafe', ['treat']), venue('closed', ['meal'], false)],
};

function draft(patch: Partial<Draft> = {}): Draft {
  return { ...emptyDraft('new-flow', '2030-02-01'), timeZone: ZONE, mealLabel: '晚餐', ...patch };
}
const restaurantDraft = (patch: Partial<Draft> = {}) => draft({ mode: 'restaurant', purpose: 'meal', ...patch });

function stubStorage(): Map<string, string> {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  });
  return values;
}

describe('editor progress on the draft', () => {
  it('opens a new plan (and clones/repeats, which carry no progress) on step 1 and a saved plan on review', () => {
    expect(resumeStep({ planId: null })).toBe(1);
    expect(resumeStep({ planId: 'p1' })).toBe(3);
    expect(resumeStep({ planId: 'p1', editorStep: 1 })).toBe(1);
    expect(resumeStep({ planId: null, editorStep: 2 })).toBe(2);
  });

  it('clamps stored progress into 1–3 and treats non-numbers as no progress', () => {
    expect(clampEditorStep(0)).toBe(1);
    expect(clampEditorStep(-4)).toBe(1);
    expect(clampEditorStep(2.4)).toBe(2);
    expect(clampEditorStep(9)).toBe(3);
    expect(clampEditorStep('2')).toBeUndefined();
    expect(clampEditorStep(Number.NaN)).toBeUndefined();
    expect(clampEditorStep(null)).toBeUndefined();
  });

  it('restores the step of a saved draft and falls back for old or corrupted ones', () => {
    const values = stubStorage();
    saveDraft(draft({ key: 'new-a', editorStep: 2, dishIds: ['d1'] }));
    expect(loadDraft('new-a')?.editorStep).toBe(2);

    // A draft saved before steps existed: no field at all, so a new plan resumes on step 1.
    const old = { ...draft({ key: 'new-old' }) } as Record<string, unknown>;
    delete old.editorStep;
    values.set('bx:draft:new-old', JSON.stringify(old));
    const restoredOld = loadDraft('new-old')!;
    expect('editorStep' in restoredOld).toBe(false);
    expect(resumeStep(restoredOld)).toBe(1);

    values.set('bx:draft:new-bad', JSON.stringify({ ...draft({ key: 'new-bad' }), editorStep: 'three' }));
    expect(resumeStep(loadDraft('new-bad')!)).toBe(1);
    values.set('bx:draft:new-big', JSON.stringify({ ...draft({ key: 'new-big' }), editorStep: 7 }));
    expect(loadDraft('new-big')?.editorStep).toBe(3);
  });

  it('keeps progress out of the request body and its idempotency fingerprint', () => {
    const base = restaurantDraft({ candidateIds: ['r1'], selectedRestaurantId: 'r1' });
    const bodies = ([undefined, 1, 2, 3] as const).map((editorStep) => draftToInput({ ...base, editorStep }));
    for (const body of bodies) expect(body).not.toHaveProperty('editorStep');
    const fingerprints = new Set(bodies.map((b) => JSON.stringify({ ...b, expectedVersion: 4 })));
    expect(fingerprints.size).toBe(1);
  });
});

describe('step 1 gate: date, name, time and zone', () => {
  it('accepts a complete future meal, with or without a time', () => {
    expect(metaErrors(draft(), NOW)).toEqual({});
    expect(metaErrors(draft({ localTime: '18:30' }), NOW)).toEqual({});
  });

  it('flags a missing name and a past date (in the plan zone), focusing the date first', () => {
    const errors = metaErrors(draft({ mealLabel: '  ', date: '2029-12-31' }), NOW);
    expect(Object.keys(errors).sort()).toEqual(['date', 'mealLabel']);
    expect(firstMetaError(errors)).toBe('date');
  });

  it('rejects a local time skipped by DST and an invalid zone', () => {
    // 2030-03-10 02:30 does not exist in New York (clocks jump to 03:00).
    expect(metaErrors(draft({ date: '2030-03-10', localTime: '02:30' }), NOW).localTime).toMatch(/夏令时/);
    expect(metaErrors(draft({ date: '2030-03-10', localTime: '03:30' }), NOW)).toEqual({});
    const badZone = metaErrors(draft({ timeZone: 'Mars/Base', localTime: '12:00' }), NOW);
    expect(badZone.timeZone).toBeTruthy();
    expect(badZone.localTime).toBeUndefined();
  });

  it('blocks step 2 and step 3 on step 1 problems, never step 1 itself', () => {
    const d = draft({ mealLabel: '' });
    expect(checkBefore(1, d, catalog, NOW)).toEqual({ ok: true });
    for (const target of [2, 3] as const) {
      const check = checkBefore(target, d, catalog, NOW);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.step).toBe(1);
    }
  });
});

describe('step 2 gate: dishes, candidates and the final venue', () => {
  const issue = (d: Draft) => selectionIssue(d, catalog)?.code ?? null;

  it('needs at least one available dish at home', () => {
    expect(issue(draft())).toBe('empty');
    expect(issue(draft({ dishIds: ['d1', 'gone'] }))).toBe('unavailable');
    expect(issue(draft({ dishIds: ['d1', 'unknown'] }))).toBe('unavailable');
    expect(issue(draft({ dishIds: ['d1', 'd2'] }))).toBeNull();
  });

  it('flags unavailable and incompatible candidates before asking for a choice', () => {
    expect(issue(restaurantDraft())).toBe('empty');
    expect(issue(restaurantDraft({ candidateIds: ['r1', 'closed'], selectedRestaurantId: 'r1' }))).toBe('unavailable');
    const treat = withOuting(draft(), 'treat');
    expect(issue({ ...treat, candidateIds: ['cafe', 'r1'], selectedRestaurantId: 'cafe' })).toBe('incompatible');
    expect(issue({ ...treat, candidateIds: ['cafe', 'both'], selectedRestaurantId: 'both' })).toBeNull();
  });

  it('requires several candidates to be narrowed to one by a draw or a direct choice', () => {
    const multi = restaurantDraft({ candidateIds: ['r1', 'r2'], selectedRestaurantId: null });
    expect(issue(multi)).toBe('needs_choice');
    const chosen = { ...multi, ...choosePatch(multi, catalog, 'r2') };
    expect(issue(chosen)).toBeNull();
    // A selection that is not in the basket does not count.
    expect(issue({ ...multi, selectedRestaurantId: 'both' })).toBe('needs_choice');
  });

  it('sends a fully valid draft to review only when both gates pass', () => {
    const ok = restaurantDraft({ candidateIds: ['r1'], selectedRestaurantId: 'r1' });
    expect(checkBefore(3, ok, catalog, NOW)).toEqual({ ok: true });
    const check = checkBefore(3, { ...ok, candidateIds: ['r1', 'r2'], selectedRestaurantId: null }, catalog, NOW);
    expect(check).toMatchObject({ ok: false, step: 2, issue: { code: 'needs_choice' } });
  });
});

describe('candidate basket keeps a valid final venue', () => {
  it('auto-chooses a single usable candidate and invalidates a draw when the basket changes', () => {
    let d = restaurantDraft();
    d = { ...d, ...withCandidates(d, catalog, ['r1']) };
    expect(d.selectedRestaurantId).toBe('r1');
    d = { ...d, ...withCandidates(d, catalog, ['r1', 'r2']) };
    expect(d.selectedRestaurantId).toBeNull();
    d = { ...d, selectedRestaurantId: 'r2' };
    d = { ...d, ...withCandidates(d, catalog, ['r1', 'r2', 'both']) };
    expect(d.selectedRestaurantId).toBeNull();
    d = { ...d, ...withCandidates(d, catalog, ['r2']) };
    expect(d.selectedRestaurantId).toBe('r2');
  });

  it('never auto-chooses an unavailable or incompatible entry', () => {
    const d = restaurantDraft();
    expect(withCandidates(d, catalog, ['closed']).selectedRestaurantId).toBeNull();
    expect(withCandidates(d, catalog, ['cafe']).selectedRestaurantId).toBeNull();
    // One usable candidate next to an unusable one is still the only possible choice.
    expect(withCandidates(d, catalog, ['closed', 'r1']).selectedRestaurantId).toBe('r1');
  });

  it('settles a restored old single-candidate draft without an extra click, but never swaps a choice', () => {
    const old = restaurantDraft({ candidateIds: ['r1'], selectedRestaurantId: null });
    expect(autoChoicePatch(old, catalog)).toEqual({ selectedRestaurantId: 'r1' });
    expect(autoChoicePatch({ ...old, selectedRestaurantId: 'r1' }, catalog)).toBeNull();
    const kept = restaurantDraft({ candidateIds: ['closed', 'r1'], selectedRestaurantId: 'closed' });
    expect(autoChoicePatch(kept, catalog)).toBeNull();
    expect(autoChoicePatch(draft({ candidateIds: ['r1'] }), catalog)).toBeNull();
  });

  it('only lets usable basket entries be chosen directly', () => {
    const d = restaurantDraft({ candidateIds: ['r1', 'r2', 'closed'] });
    expect(choosePatch(d, catalog, 'r2')).toEqual({ selectedRestaurantId: 'r2' });
    expect(choosePatch(d, catalog, 'closed')).toBeNull();
    expect(choosePatch(d, catalog, 'both')).toBeNull();
    const treat = { ...withOuting(draft(), 'treat'), candidateIds: ['cafe', 'r1'] };
    expect(choosePatch(treat, catalog, 'r1')).toBeNull();
  });

  it('drops a delayed draw whose basket changed meanwhile', () => {
    const start = restaurantDraft({ candidateIds: ['r1', 'r2'] });
    const sig = basketSignature(start);
    expect(drawCommit(sig, start, 'r2')).toEqual({ selectedRestaurantId: 'r2' });
    expect(drawCommit(sig, { ...start, candidateIds: ['r1', 'r2', 'both'] }, 'r2')).toBeNull();
    expect(drawCommit(sig, { ...start, purpose: 'treat' }, 'r2')).toBeNull();
    expect(drawCommit(sig, start, null)).toBeNull();
    // Choosing directly (not a basket change) keeps the basket signature.
    expect(basketSignature({ ...start, selectedRestaurantId: 'r1' })).toBe(sig);
  });
});

describe('submitting straight from review', () => {
  it('sends an edited plan whose date has passed back to step 1, date first', () => {
    const edit = restaurantDraft({ planId: 'p1', editorStep: 3, date: '2029-12-20', candidateIds: ['r1'], selectedRestaurantId: 'r1' });
    const check = checkBefore(3, edit, catalog, NOW);
    expect(check).toMatchObject({ ok: false, step: 1 });
    if (!check.ok && check.step === 1) expect(firstMetaError(check.fields)).toBe('date');
  });

  it('sends a plan whose dish left the menu back to step 2', () => {
    const edit = draft({ planId: 'p1', editorStep: 3, dishIds: ['d1', 'gone'] });
    expect(checkBefore(3, edit, catalog, NOW)).toMatchObject({ ok: false, step: 2, issue: { code: 'unavailable' } });
  });

  it('maps server rejections to the step that holds the fix', () => {
    expect(stepForServerError('past_date', 'date')).toBe(1);
    expect(stepForServerError('nonexistent_time', 'localTime')).toBe(1);
    expect(stepForServerError('invalid_request', 'timeZone')).toBe(1);
    expect(stepForServerError('unavailable_items')).toBe(2);
    expect(stepForServerError('incompatible_purpose')).toBe(2);
    expect(stepForServerError('invalid_selection', 'selectedRestaurantId')).toBe(2);
    expect(stepForServerError('rate_limited')).toBeNull();
    expect(stepForServerError('invalid_request', 'note')).toBeNull();
  });
});

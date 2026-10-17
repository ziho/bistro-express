import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { isValidDateString } from '../../../../shared/time';
import type { Plan } from '../../../../shared/types';
import { editDraftKey, emptyDraft, loadDraft, newDraftKey, saveDraft, type Draft, type EditorStep } from '../../lib/drafts';
import { resumeStep } from '../../lib/editorFlow';
import { withOuting } from '../../lib/outing';

/** A saved plan opens on its review step: everything is already filled in. */
function draftFromPlan(plan: Plan): Draft {
  return {
    ...emptyDraft(editDraftKey(plan.id), plan.date),
    planId: plan.id,
    baseVersion: plan.version,
    mealLabel: plan.mealLabel,
    localTime: plan.localTime ?? '',
    timeZone: plan.timeZone,
    mode: plan.mode,
    purpose: plan.purpose === 'treat' ? 'treat' : 'meal',
    note: plan.note,
    dishIds: plan.dishes.map((d) => d.id),
    candidateIds: plan.candidates.map((c) => c.id),
    selectedRestaurantId: plan.selectedRestaurant?.id ?? null,
    sourcePlanId: plan.sourcePlanId,
    editorStep: 3,
  };
}

/**
 * Owns the editor draft: restores it from this device, autosaves after each committed change,
 * and keeps the draft key in the URL so a refresh recovers the same draft.
 */
export function useEditorDraft(opts: { planId?: string; plan?: Plan; today: string }) {
  const { planId, plan, today } = opts;
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [restored, setRestored] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (draft) return;
    if (planId) {
      if (!plan) return;
      const existing = loadDraft(editDraftKey(planId));
      if (existing) {
        setDraft({ ...existing, editorStep: resumeStep(existing) });
        setRestored(true);
        dirty.current = true;
      } else {
        setDraft(draftFromPlan(plan));
      }
      return;
    }
    const key = params.get('draft');
    const existing = key ? loadDraft(key) : null;
    if (existing) {
      // Clones and repeats are stored without progress, so they start on step 1.
      setDraft({ ...existing, editorStep: resumeStep(existing) });
      setRestored(true);
      dirty.current = true;
      return;
    }
    const requested = params.get('date');
    const date = requested && isValidDateString(requested) && requested >= today ? requested : today;
    const blank = emptyDraft(key && /^new-[\w-]+$/.test(key) ? key : newDraftKey(), date);
    // 「饮番杯」 on the home page opens a treat outing straight away.
    const fresh = params.get('purpose') === 'treat' ? withOuting(blank, 'treat') : blank;
    setDraft({ ...fresh, editorStep: 1 });
    setParams({ draft: fresh.key }, { replace: true });
  }, [draft, planId, plan, params, setParams, today]);

  const latest = useRef<Draft | null>(null);
  latest.current = draft;

  useEffect(() => {
    if (!draft || !dirty.current) return;
    saveDraft(draft);
  }, [draft]);

  // Flush immediately when the page is being hidden/closed so nothing typed is lost.
  useEffect(() => {
    const flush = () => {
      if (latest.current && dirty.current) saveDraft(latest.current);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  /** Stop autosaving (used right after a successful submit cleared the draft). */
  const discard = useCallback(() => {
    dirty.current = false;
  }, []);

  const update = useCallback((patch: Partial<Draft>) => {
    dirty.current = true;
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  /** Step progress is a draft change too: prefilled outings must survive a refresh. */
  const setStep = useCallback((editorStep: EditorStep) => {
    if (latest.current && latest.current.editorStep !== editorStep) dirty.current = true;
    setDraft((prev) => (prev && prev.editorStep !== editorStep ? { ...prev, editorStep } : prev));
  }, []);

  const resetFromPlan = useCallback((p: Plan) => {
    dirty.current = false;
    setDraft(draftFromPlan(p));
    setRestored(false);
  }, []);

  return { draft, update, setStep, restored, resetFromPlan, setRestored, discard };
}

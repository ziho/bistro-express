import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorStep } from '../../lib/editorFlow';
import { animateFeedback, motionAllowed } from '../../lib/motion';

/** 'heading' = the step's own heading; 'issue' = the step's error message; otherwise an element id. */
export type FocusTarget = 'heading' | 'issue' | { id: string };

const ENTER_MS = 200;

/**
 * Focus, scroll and a short entrance only when something asked for it (a step change, a blocked
 * 下一步, a rejected submit) — never on typing, autosave or a background refresh.
 * Only blocks marked data-step-motion move; "lift" may translate (it never contains fixed or
 * sticky bars), "fade" changes opacity only. Keyboard and reduced motion settle instantly.
 */
export function useStepTransition(step: EditorStep) {
  const top = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const issue = useRef<HTMLParagraphElement>(null);
  const [request, setRequest] = useState<{ target: FocusTarget; seq: number } | null>(null);
  const shown = useRef(step);

  useEffect(() => {
    if (!request) return;
    const changed = shown.current !== step;
    shown.current = step;
    const { target } = request;
    const el =
      target === 'heading' ? heading.current : target === 'issue' ? issue.current : document.getElementById(target.id);
    if (changed) {
      for (const block of top.current?.querySelectorAll<HTMLElement>('[data-step-motion]') ?? []) {
        const lift = block.dataset.stepMotion === 'lift';
        animateFeedback(
          block,
          lift ? [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }] : [{ opacity: 0 }, { opacity: 1 }],
          { duration: ENTER_MS },
        );
      }
    }
    if (target === 'heading' || !el) {
      if (changed) top.current?.scrollIntoView({ block: 'start', behavior: motionAllowed() ? 'smooth' : 'auto' });
      (el ?? heading.current)?.focus({ preventScroll: changed });
    } else {
      el.focus();
      el.scrollIntoView({ block: 'center', behavior: motionAllowed() ? 'smooth' : 'auto' });
    }
    // Only a new request moves focus; re-renders from typing or autosave do not.
  }, [request]);

  // A step change without a request (e.g. the draft just loaded) is not announced or animated.
  useEffect(() => {
    if (!request) shown.current = step;
  }, [request, step]);

  const focusStep = useCallback((target: FocusTarget) => {
    setRequest((r) => ({ target, seq: (r?.seq ?? 0) + 1 }));
  }, []);

  return { top, heading, issue, focusStep };
}

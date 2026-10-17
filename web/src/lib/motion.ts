/** Motion stays optional: keyboard input and reduced-motion both settle immediately. */
export const MOTION_EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const SHEET_EXIT_MS = 160;
const owned = new Set<Animation>();

export function motionAllowed(): boolean {
  return document.documentElement.dataset.motionInput !== 'keyboard' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keep the exit mounted for its visual fade; keyboard closes synchronously. */
export function motionExitDuration(): number {
  if (document.documentElement.dataset.motionInput === 'keyboard') return 0;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 80 : SHEET_EXIT_MS;
}

/** Only our own WAAPI effects are cancelled; functional animations elsewhere are untouched. */
export function animateFeedback(
  element: HTMLElement | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!element?.animate || !motionAllowed()) return null;
  const effect = element.animate(keyframes, { easing: MOTION_EASE_OUT, ...options });
  owned.add(effect);
  void effect.finished.then(() => owned.delete(effect), () => owned.delete(effect));
  return effect;
}

/** App lifetime input policy. CSS uses the same signal as programmatic animations. */
export function installMotionPreferences(): void {
  const root = document.documentElement;
  root.dataset.motionInput = 'pointer';
  const settle = () => {
    for (const effect of owned) effect.cancel();
    owned.clear();
  };
  document.addEventListener('keydown', (event) => {
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    root.dataset.motionInput = 'keyboard';
    settle();
  }, true);
  document.addEventListener('pointerdown', () => {
    root.dataset.motionInput = 'pointer';
  }, { capture: true, passive: true });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    if (event.matches) settle();
  });
}

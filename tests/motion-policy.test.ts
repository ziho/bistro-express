import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  vi.resetModules();
  const events = new EventTarget();
  const preference = new EventTarget();
  let reduced = false;
  const root = { dataset: {} as Record<string, string> };
  vi.stubGlobal('document', {
    documentElement: root,
    addEventListener: events.addEventListener.bind(events),
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() { return reduced; },
      addEventListener: preference.addEventListener.bind(preference),
    }),
  });
  const policy = await import('../web/src/lib/motion');
  policy.installMotionPreferences();
  return {
    policy, events, root,
    reduce() {
      reduced = true;
      const event = new Event('change');
      Object.defineProperty(event, 'matches', { value: true });
      preference.dispatchEvent(event);
    },
  };
}

const keyEvent = (key: string) => {
  const event = new Event('keydown');
  Object.defineProperty(event, 'key', { value: key });
  return event;
};

describe('input-aware motion policy', () => {
  it('settles our in-flight feedback on keyboard input and resumes after the next pointer action', async () => {
    const { policy, events } = await setup();
    const effect = { finished: new Promise<Animation>(() => {}), cancel: vi.fn() } as unknown as Animation;
    const element = { animate: vi.fn(() => effect) } as unknown as HTMLElement;
    expect(policy.animateFeedback(element, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 120 })).toBe(effect);
    events.dispatchEvent(keyEvent('Enter'));
    expect(effect.cancel).toHaveBeenCalledOnce();
    expect(policy.motionAllowed()).toBe(false);
    expect(policy.motionExitDuration()).toBe(0);
    expect(policy.animateFeedback(element, [], { duration: 120 })).toBeNull();
    expect(element.animate).toHaveBeenCalledOnce();
    events.dispatchEvent(new Event('pointerdown'));
    expect(policy.motionAllowed()).toBe(true);
    expect(policy.motionExitDuration()).toBe(160);
  });

  it('honors a reduced-motion preference change during a transition, with a brief opacity-only exit budget', async () => {
    const { policy, reduce } = await setup();
    const effect = { finished: new Promise<Animation>(() => {}), cancel: vi.fn() } as unknown as Animation;
    const element = { animate: vi.fn(() => effect) } as unknown as HTMLElement;
    policy.animateFeedback(element, [], { duration: 180 });
    reduce();
    expect(effect.cancel).toHaveBeenCalledOnce();
    expect(policy.motionAllowed()).toBe(false);
    expect(policy.motionExitDuration()).toBe(80);
    expect(policy.animateFeedback(element, [], { duration: 180 })).toBeNull();
  });

  it('does not cancel completed effects or require WAAPI support for the interface to work', async () => {
    const { policy, events } = await setup();
    const effect = { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation;
    const element = { animate: vi.fn(() => effect) } as unknown as HTMLElement;
    policy.animateFeedback(element, [], { duration: 120 });
    await Promise.resolve();
    events.dispatchEvent(keyEvent('Tab'));
    expect(effect.cancel).not.toHaveBeenCalled();
    expect(policy.animateFeedback({} as HTMLElement, [], { duration: 120 })).toBeNull();
  });
});

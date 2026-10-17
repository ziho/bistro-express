import { useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { animateFeedback } from '../lib/motion';

/** A short opacity handoff only on navigation; refreshes and typing never replay it.
 * No moving ancestor: fixed mobile action bars keep their viewport position. */
export function MotionOutlet() {
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    const effect = animateFeedback(ref.current, [{ opacity: 0.72 }, { opacity: 1 }], { duration: 120 });
    return () => effect?.cancel();
  }, [pathname]);
  return <div ref={ref} className="motion-outlet"><Outlet /></div>;
}

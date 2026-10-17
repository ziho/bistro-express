import { CupSoda, Home, Store, type LucideIcon } from 'lucide-react';
import { outingKind, type OutingKind } from '../../../shared/venue';
import type { PlanMode, VenuePurpose } from '../../../shared/types';

/** One icon per kind of outing, used by cards, details, the editor and the summary. */
export const OUTING_ICON: Record<OutingKind, LucideIcon> = { home: Home, restaurant: Store, treat: CupSoda };

export function OutingIcon({ plan }: { plan: { mode: PlanMode; purpose?: VenuePurpose } }) {
  const Icon = OUTING_ICON[outingKind(plan)];
  return <Icon aria-hidden="true" />;
}

/** CSS modifier for the coloured icon tile: mode-home / mode-restaurant / mode-treat. */
export const outingClass = (plan: { mode: PlanMode; purpose?: VenuePurpose }) => `mode-${outingKind(plan)}`;

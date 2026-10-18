import { ChevronRight, Clock } from 'lucide-react';
import { Link } from 'react-router';
import type { Plan } from '../../../shared/types';
import { OUTING_LABEL, OUTING_STANDARD_LABEL, outingKind } from '../../../shared/venue';
import { planDisplay, planItemsText } from '../lib/planView';
import { NotificationBadge, SavedBadge } from './NotificationBadge';
import { OutingIcon, outingClass } from './OutingIcon';

export function PlanCard({ plan, showDate = false, standard = false }: { plan: Plan; showDate?: boolean; standard?: boolean }) {
  const view = planDisplay(plan);
  const cancelled = plan.status === 'cancelled';
  const labels = standard ? OUTING_STANDARD_LABEL : OUTING_LABEL;
  return (
    <Link to={`/plans/${plan.id}`} className={`plan-card ${cancelled ? 'is-cancelled' : ''}`}>
      <div className={`plan-card-icon ${outingClass(plan)}`} aria-hidden="true">
        <OutingIcon plan={plan} />
      </div>
      <div className="plan-card-body">
        <div className="plan-card-title">
          <strong>{plan.mealLabel}</strong>
          {showDate && <span className="muted">{view.date}</span>}
          {view.time && (
            <span className="plan-time">
              <Clock aria-hidden="true" />
              {view.time}
            </span>
          )}
          {outingKind(plan) === 'treat' ? (
            <span className="badge badge-treat">{labels.treat}</span>
          ) : (
            <span className="sr-only">{labels[outingKind(plan)]}</span>
          )}
        </div>
        <p className="plan-card-items">{planItemsText(plan)}</p>
        {view.originDetail && <p className="plan-card-origin">{view.originDetail}</p>}
        <div className="badge-row">
          <SavedBadge cancelled={cancelled} />
          <NotificationBadge notification={plan.notification} />
        </div>
      </div>
      <ChevronRight className="plan-card-chevron" aria-hidden="true" />
    </Link>
  );
}

import { ChevronRight, Clock, Home, Store } from 'lucide-react';
import { Link } from 'react-router';
import type { Plan } from '../../../shared/types';
import { planDisplay, planItemsText } from '../lib/planView';
import { NotificationBadge, SavedBadge } from './NotificationBadge';

export function PlanCard({ plan, showDate = false }: { plan: Plan; showDate?: boolean }) {
  const view = planDisplay(plan);
  const cancelled = plan.status === 'cancelled';
  return (
    <Link to={`/plans/${plan.id}`} className={`plan-card ${cancelled ? 'is-cancelled' : ''}`}>
      <div className={`plan-card-icon mode-${plan.mode}`} aria-hidden="true">
        {plan.mode === 'home' ? <Home /> : <Store />}
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
          <span className="sr-only">{plan.mode === 'home' ? '在家吃' : '去餐厅'}</span>
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

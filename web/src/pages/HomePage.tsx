import { CalendarPlus, CupSoda, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addDays, formatDateLabel, isValidDateString } from '../../../shared/time';
import { OUTING_LABEL } from '../../../shared/venue';
import { useCatalog, usePlans } from '../api/queries';
import { DateStrip } from '../components/DateStrip';
import { DraftList } from '../components/DraftList';
import { Cloche, TableForTwo } from '../components/Illustrations';
import { Loading } from '../components/Loading';
import { PlanCard } from '../components/PlanCard';
import { groupByViewerDate, upcomingActiveDays } from '../lib/agenda';
import { shortDateLabel } from '../lib/calendar';
import { useToday } from '../lib/hooks';
import { planDisplay } from '../lib/planView';

const AGENDA_DAYS = 10;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 10) return '早晨，今日食乜好？';
  if (h < 14) return '到点开饭，食乜好？';
  if (h < 18) return '今晚食乜？';
  return '下一顿食乜？';
}

export function HomePage() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const raw = params.get('date');
  const selected = raw && isValidDateString(raw) && raw >= today ? raw : today;
  const plans = usePlans({ from: addDays(today, -2) });
  const catalog = useCatalog();

  const byDate = useMemo(() => groupByViewerDate(plans.data ?? []), [plans.data]);
  const activeDays = useMemo(() => upcomingActiveDays(byDate, today), [byDate, today]);
  // The calendar marks every active date; only the sidebar agenda is shortened.
  const marked = useMemo(() => new Set(activeDays.map(([d]) => d)), [activeDays]);
  const upcoming = activeDays.slice(0, AGENDA_DAYS);
  const dayPlans = byDate.get(selected) ?? [];
  const catalogEmpty = catalog.data && catalog.data.dishes.length === 0 && catalog.data.restaurants.length === 0;

  const select = (date: string) => setParams(date === today ? {} : { date }, { replace: true });

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-text">
          <p className="hero-kicker">
            <Sparkles aria-hidden="true" /> {formatDateLabel(today)}
          </p>
          <h1>{greeting()}</h1>
          <p className="muted">屋企煮、出街食，还是饮番杯？</p>
        </div>
        <TableForTwo className="hero-art" />
      </section>

      {catalogEmpty && (
        <div className="notice notice-butter">
          <Cloche className="notice-art" />
          <div>
            <strong>菜单还是空的</strong>
            <p className="small">后台添好菜、收藏好店铺，这里就能选。</p>
          </div>
        </div>
      )}

      <div className="home-grid">
        <section className="day-panel" aria-labelledby="day-title">
          <DateStrip today={today} value={selected} onChange={select} markedDates={marked} />
          <div className="day-head">
            <h2 id="day-title">{selected === today ? `今天 · ${formatDateLabel(selected)}` : shortDateLabel(selected, today)}</h2>
            <div className="day-actions">
              <Link className="btn btn-primary" to={`/plans/new?date=${selected}`}>
                <CalendarPlus aria-hidden="true" />
                安排一顿
              </Link>
              <Link className="btn btn-butter" to={`/plans/new?date=${selected}&purpose=treat`}>
                <CupSoda aria-hidden="true" />
                饮番杯
              </Link>
            </div>
          </div>
          {plans.isPending ? (
            <Loading />
          ) : plans.isError ? (
            <p className="error-text" role="alert">
              安排加载失败：{plans.error.message}
            </p>
          ) : dayPlans.length === 0 ? (
            <div className="empty-day">
              <p>这天还没安排。</p>
              <p className="muted small">正餐、奶茶、糖水，都可以单独安排。</p>
            </div>
          ) : (
            <ul className="plan-list">
              {dayPlans.map((p) => (
                <li key={p.id}>
                  <PlanCard plan={p} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="agenda" aria-labelledby="agenda-title">
          <h2 id="agenda-title" className="section-title">
            接下来
          </h2>
          {upcoming.length === 0 && !plans.isPending ? (
            <p className="muted small">还没安排下一顿。</p>
          ) : (
            <ol className="agenda-list">
              {upcoming.map(([date, list]) => (
                <li key={date}>
                  <button
                    type="button"
                    className="agenda-date"
                    aria-current={date === selected ? 'date' : undefined}
                    onClick={() => select(date)}
                  >
                    <span className="agenda-date-label">{date === today ? '今天' : shortDateLabel(date, today)}</span>
                    <span className="agenda-meals">
                      {list
                        .filter((p) => p.status === 'active')
                        .map((p) => {
                          const t = planDisplay(p).time;
                          // A drinks / dessert stop is named as such, never counted as a meal.
                          return `${p.mealLabel}${p.purpose === 'treat' ? `（${OUTING_LABEL.treat}）` : ''}${t ? ` ${t}` : ''}`;
                        })
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <DraftList />
        </aside>
      </div>
    </div>
  );
}

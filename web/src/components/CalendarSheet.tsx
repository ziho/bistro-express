import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  clampDate,
  compareMonth,
  fullDateLabel,
  monthGrid,
  monthOf,
  monthTitle,
  moveByKey,
  parseDateEntry,
  withMonth,
  WEEKDAY_HEADERS,
  type CalendarKey,
} from '../lib/calendar';
import { Sheet } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  today: string;
  value: string;
  /** Dates that already have an active plan. */
  markedDates: Set<string>;
  onSelect: (date: string) => void;
}

const NAV_KEYS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const YEARS_AHEAD = 10;

/** Our own month calendar in the shared Sheet (focus trap, Esc, bottom sheet on phones). */
export function CalendarSheet({ open, onClose, today, value, markedDates, onSelect }: Props) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="选择日期"
      variant="drawer"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-butter" onClick={() => onSelect(today)}>
            回到今天
          </button>
        </>
      }
    >
      <CalendarBody today={today} value={value} markedDates={markedDates} onSelect={onSelect} />
    </Sheet>
  );
}

function CalendarBody({ today, value, markedDates, onSelect }: Omit<Props, 'open' | 'onClose'>) {
  const titleId = useId();
  const entryId = useId();
  const [focus, setFocus] = useState(() => clampDate(value, today));
  const [entry, setEntry] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const moveDomFocus = useRef(true); // focus the selected day when the sheet opens
  const view = monthOf(focus);
  const todayMonth = monthOf(today);

  useEffect(() => {
    if (!moveDomFocus.current) return;
    moveDomFocus.current = false;
    // Deferred so it runs after the parent's <dialog>.showModal() has placed initial focus.
    const timer = window.setTimeout(() => {
      gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focus]);

  const go = (date: string, moveFocus = false) => {
    moveDomFocus.current = moveFocus;
    setFocus(clampDate(date, today));
  };

  const onGridKey = (e: KeyboardEvent) => {
    if (!NAV_KEYS.has(e.key)) return;
    e.preventDefault();
    go(moveByKey(focus, e.key as CalendarKey, e.shiftKey), true);
  };

  const submitEntry = (e: FormEvent) => {
    e.preventDefault();
    const date = parseDateEntry(entry);
    if (!date) return setEntryError('没看懂这个日期，请按 2027-03-05 这样的格式输入');
    if (date < today) return setEntryError('不能选择已经过去的日期；以前的计划请到「历史」里查看');
    setEntryError(null);
    onSelect(date);
  };

  const lastYear = Math.max(todayMonth.year + YEARS_AHEAD, view.year);
  const years = Array.from({ length: lastYear - todayMonth.year + 1 }, (_, i) => todayMonth.year + i);

  return (
    <div className="calendar">
      <div className="cal-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="上个月"
          disabled={compareMonth(view, todayMonth) <= 0}
          onClick={() => go(moveByKey(focus, 'PageUp'))}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <h3 id={titleId} className="cal-title" aria-live="polite">
          {monthTitle(view)}
        </h3>
        <button type="button" className="icon-btn" aria-label="下个月" onClick={() => go(moveByKey(focus, 'PageDown'))}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>

      <div className="cal-jump">
        <label className="sr-only" htmlFor={`${titleId}-year`}>
          跳到年份
        </label>
        <select
          id={`${titleId}-year`}
          className="input cal-select"
          value={view.year}
          onChange={(e) => go(withMonth(focus, { year: Number(e.target.value), month: view.month }))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${titleId}-month`}>
          跳到月份
        </label>
        <select
          id={`${titleId}-month`}
          className="input cal-select"
          value={view.month}
          onChange={(e) => go(withMonth(focus, { year: view.year, month: Number(e.target.value) }))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m} disabled={view.year === todayMonth.year && m < todayMonth.month}>
              {m}月
            </option>
          ))}
        </select>
      </div>

      <table className="cal-grid" ref={gridRef} aria-labelledby={titleId} onKeyDown={onGridKey}>
        <thead>
          <tr>
            {WEEKDAY_HEADERS.map((w) => (
              <th key={w} scope="col" abbr={`星期${w}`}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(view).map((week, i) => (
            <tr key={i}>
              {week.map((d, j) => (
                <td key={d ?? `empty-${j}`}>
                  {d && (
                    <DayButton
                      date={d}
                      today={today}
                      selected={d === value}
                      focusable={d === focus}
                      marked={markedDates.has(d)}
                      onFocus={() => setFocus(d)}
                      onSelect={onSelect}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cal-legend muted small" aria-hidden="true">
        <span className="cal-legend-dot" /> 已有安排 <span className="cal-legend-today" /> 今天
      </p>

      <form className="cal-entry" onSubmit={submitEntry} noValidate>
        <label className="field-label" htmlFor={entryId}>
          更远的日期？直接输入
        </label>
        <div className="cal-entry-row">
          <input
            id={entryId}
            className="input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="例如 2027-03-05"
            value={entry}
            aria-invalid={entryError ? true : undefined}
            aria-describedby={entryError ? `${entryId}-err` : undefined}
            onChange={(e) => setEntry(e.target.value)}
          />
          <button type="submit" className="btn btn-ghost" disabled={!entry.trim()}>
            前往
          </button>
        </div>
        {entryError && (
          <p id={`${entryId}-err`} className="field-error" role="alert">
            {entryError}
          </p>
        )}
      </form>
    </div>
  );
}

function DayButton(props: {
  date: string;
  today: string;
  selected: boolean;
  focusable: boolean;
  marked: boolean;
  onFocus: () => void;
  onSelect: (date: string) => void;
}) {
  const { date, today, selected, focusable, marked } = props;
  const past = date < today;
  const label = [
    fullDateLabel(date),
    date === today && '今天',
    marked && '已有安排',
    selected && '已选中',
    past && '已过去，不可选',
  ]
    .filter(Boolean)
    .join('，');
  return (
    <button
      type="button"
      className="cal-day"
      data-date={date}
      data-marked={marked || undefined}
      tabIndex={focusable ? 0 : -1}
      disabled={past}
      aria-pressed={selected}
      aria-current={date === today ? 'date' : undefined}
      aria-label={label}
      onFocus={props.onFocus}
      onClick={() => props.onSelect(date)}
    >
      {Number(date.slice(8))}
    </button>
  );
}

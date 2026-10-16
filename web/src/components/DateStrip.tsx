import { CalendarSearch } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { addDays, weekdayShort } from '../../../shared/time';

interface Props {
  today: string;
  value: string;
  onChange: (date: string) => void;
  markedDates: Set<string>;
  days?: number;
}

/** Horizontally scrolling day picker plus a native date field for any future date. */
export function DateStrip({ today, value, onChange, markedDates, days = 21 }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const pickerId = useId();
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [value]);

  return (
    <div className="date-strip">
      <div className="date-strip-list" ref={listRef} role="group" aria-label="选择日期">
        {dates.map((d) => {
          const [, m, day] = d.split('-');
          const label = d === today ? '今天' : d === addDays(today, 1) ? '明天' : weekdayShort(d);
          return (
            <button
              key={d}
              type="button"
              className="date-chip"
              aria-pressed={d === value}
              aria-label={`${Number(m)}月${Number(day)}日 ${label}${markedDates.has(d) ? '，已有安排' : ''}`}
              onClick={() => onChange(d)}
            >
              <span className="date-chip-week">{label}</span>
              <span className="date-chip-day">{Number(day)}</span>
              <span className="date-chip-dot" data-on={markedDates.has(d) || undefined} />
            </button>
          );
        })}
      </div>
      <label className="date-strip-picker" htmlFor={pickerId}>
        <CalendarSearch aria-hidden="true" />
        <span className="sr-only">选择其他日期</span>
        <input
          id={pickerId}
          type="date"
          min={today}
          value={value}
          onChange={(e) => e.target.value && onChange(e.target.value < today ? today : e.target.value)}
        />
      </label>
    </div>
  );
}

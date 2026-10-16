import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { addDays, weekdayShort } from '../../../shared/time';
import { fullDateLabel, shortDateLabel } from '../lib/calendar';
import { CalendarSheet } from './CalendarSheet';

interface Props {
  today: string;
  value: string;
  onChange: (date: string) => void;
  /** Every date with an active plan (not just the first few). */
  markedDates: Set<string>;
}

const STRIP_DAYS = 7;

/** The next 7 days as quick chips, plus "选择日期" opening our own month calendar for any future date. */
export function DateStrip({ today, value, onChange, markedDates }: Props) {
  const [open, setOpen] = useState(false);
  const dates = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));
  const tomorrow = addDays(today, 1);
  const inStrip = dates.includes(value);

  return (
    <div className="date-strip">
      <div className="date-strip-list" role="group" aria-label="最近 7 天">
        {dates.map((d) => {
          const label = d === today ? '今天' : d === tomorrow ? '明天' : weekdayShort(d);
          const marked = markedDates.has(d);
          return (
            <button
              key={d}
              type="button"
              className="date-chip"
              aria-pressed={d === value}
              aria-label={`${fullDateLabel(d)}${d === today || d === tomorrow ? `，${label}` : ''}${marked ? '，已有安排' : ''}`}
              onClick={() => onChange(d)}
            >
              <span className="date-chip-week">{label}</span>
              <span className="date-chip-day">{Number(d.slice(8))}</span>
              <span className="date-chip-dot" data-on={marked || undefined} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="date-strip-more"
        data-active={!inStrip || undefined}
        aria-haspopup="dialog"
        aria-label={inStrip ? '选择日期，打开月历' : `选择日期，当前已选 ${fullDateLabel(value)}，打开月历`}
        onClick={() => setOpen(true)}
      >
        <CalendarDays aria-hidden="true" />
        <span className="date-strip-more-text">
          <span>选择日期</span>
          {!inStrip && <strong>{shortDateLabel(value, today)}</strong>}
        </span>
      </button>
      <CalendarSheet
        open={open}
        onClose={() => setOpen(false)}
        today={today}
        value={value}
        markedDates={markedDates}
        onSelect={(d) => {
          setOpen(false);
          onChange(d);
        }}
      />
    </div>
  );
}

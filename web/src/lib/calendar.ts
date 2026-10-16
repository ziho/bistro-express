import { DateTime } from 'luxon';

/**
 * Calendar maths on date-only "YYYY-MM-DD" strings. Everything goes through luxon in UTC so a
 * calendar day never shifts with the browser's offset (no `new Date('2030-01-05')` anywhere).
 */

export const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEKDAY_LONG = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
export const MAX_DATE = '9999-12-31';

export interface MonthCursor {
  year: number;
  /** 1–12 */
  month: number;
}

const dt = (date: string) => DateTime.fromISO(date, { zone: 'UTC' });
const iso = (d: DateTime) => d.toISODate() ?? '';

export function monthOf(date: string): MonthCursor {
  const d = dt(date);
  return { year: d.year, month: d.month };
}

export function compareMonth(a: MonthCursor, b: MonthCursor): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** Monday-first weeks of a month; days outside the month are null. */
export function monthGrid({ year, month }: MonthCursor): (string | null)[][] {
  const first = DateTime.fromObject({ year, month, day: 1 }, { zone: 'UTC' });
  const cells: (string | null)[] = Array.from({ length: first.weekday - 1 }, () => null);
  for (let day = 1; day <= (first.daysInMonth ?? 30); day += 1) cells.push(iso(first.set({ day })));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/** "2026年10月16日 星期五" — the full accessible name of a day. */
export function fullDateLabel(date: string): string {
  const d = dt(date);
  return d.isValid ? `${d.year}年${d.month}月${d.day}日 ${WEEKDAY_LONG[d.weekday - 1]}` : date;
}

/** Compact label; the year is only shown when it differs from today's. */
export function shortDateLabel(date: string, today: string): string {
  const d = dt(date);
  if (!d.isValid) return date;
  const week = `周${WEEKDAY_HEADERS[d.weekday - 1]}`;
  return d.year === dt(today).year ? `${d.month}月${d.day}日 ${week}` : `${d.year}年${d.month}月${d.day}日 ${week}`;
}

export const monthTitle = ({ year, month }: MonthCursor) => `${year}年${month}月`;

export const clampDate = (date: string, min: string, max = MAX_DATE) => (date < min ? min : date > max ? max : date);

/** Same day-of-month in another month (clamped to that month's length, e.g. 31 → 30). */
export function withMonth(date: string, cursor: MonthCursor): string {
  const d = dt(date);
  const target = DateTime.fromObject({ year: cursor.year, month: cursor.month, day: 1 }, { zone: 'UTC' });
  return iso(target.set({ day: Math.min(d.day, target.daysInMonth ?? 28) }));
}

export type CalendarKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

/** Keyboard movement following the WAI-ARIA date picker pattern (Shift+Page = ±1 year). */
export function moveByKey(date: string, key: CalendarKey, shift = false): string {
  const d = dt(date);
  const moved = {
    ArrowLeft: () => d.minus({ days: 1 }),
    ArrowRight: () => d.plus({ days: 1 }),
    ArrowUp: () => d.minus({ weeks: 1 }),
    ArrowDown: () => d.plus({ weeks: 1 }),
    Home: () => d.minus({ days: d.weekday - 1 }),
    End: () => d.plus({ days: 7 - d.weekday }),
    PageUp: () => d.minus(shift ? { years: 1 } : { months: 1 }),
    PageDown: () => d.plus(shift ? { years: 1 } : { months: 1 }),
  }[key]();
  return iso(moved);
}

/**
 * Typed date entry for far-away days. Accepts 2027-03-05, 2027/3/5, 2027.3.5, 2027年3月5日, 20270305.
 * Returns null for anything that is not a real calendar date.
 */
export function parseDateEntry(text: string): string | null {
  const t = text.trim().replace(/\s+/g, '');
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(t) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (!m) return null;
  const d = DateTime.fromObject({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, { zone: 'UTC' });
  return d.isValid ? iso(d) : null;
}

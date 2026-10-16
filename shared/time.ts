import { DateTime, IANAZone } from 'luxon';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  return DateTime.fromISO(value, { zone: 'UTC' }).isValid;
}

export function isValidTimeString(value: string): boolean {
  return TIME_RE.test(value);
}

export function isValidTimeZone(zone: string): boolean {
  return typeof zone === 'string' && zone.length <= 64 && IANAZone.isValidZone(zone);
}

/** Calendar date ("today") in a given IANA zone. */
export function todayInZone(zone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(zone).toISODate() ?? '';
}

export type LocalResolution =
  | { ok: true; instant: string; ambiguous: boolean; offsetLabel: string }
  | { ok: false; reason: 'invalid_zone' | 'invalid_input' | 'nonexistent_time' };

/**
 * Resolve a wall-clock date/time in a zone to an instant.
 * - Times skipped by a DST jump (e.g. 02:30 on spring-forward day) are rejected.
 * - Times repeated by a DST fall-back resolve to the earlier occurrence.
 */
export function resolveLocalDateTime(date: string, time: string, zone: string): LocalResolution {
  if (!isValidTimeZone(zone)) return { ok: false, reason: 'invalid_zone' };
  if (!isValidDateString(date) || !isValidTimeString(time)) return { ok: false, reason: 'invalid_input' };
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) return { ok: false, reason: 'invalid_input' };
  if (dt.toFormat('yyyy-MM-dd HH:mm') !== `${date} ${time}`) {
    return { ok: false, reason: 'nonexistent_time' };
  }
  const options = dt.getPossibleOffsets();
  const earliest = options.reduce((a, b) => (b.toMillis() < a.toMillis() ? b : a), dt);
  return {
    ok: true,
    instant: earliest.toUTC().toISO({ suppressMilliseconds: true }) ?? '',
    ambiguous: options.length > 1,
    offsetLabel: earliest.toFormat('ZZ'),
  };
}

export const TIME_ERROR_MESSAGES: Record<'invalid_zone' | 'invalid_input' | 'nonexistent_time', string> = {
  invalid_zone: '时区无效，请刷新页面后重试',
  invalid_input: '日期或时间格式不正确',
  nonexistent_time: '这个时间因夏令时调整在该时区并不存在，请换一个时间',
};

/** A plan is past (read-only) once its date is before "today" in the plan's original zone. */
export function isPastDate(date: string, zone: string, now: Date = new Date()): boolean {
  const zoneToday = todayInZone(isValidTimeZone(zone) ? zone : 'UTC', now);
  return date < zoneToday;
}

export interface DisplayTime {
  /** Date the meal falls on for the viewer. */
  date: string;
  /** HH:mm in the viewer's zone, or null for date-only meals. */
  time: string | null;
  /** Original wall-clock detail when it differs from the viewer's zone. */
  originDetail: string | null;
}

/** Convert a plan's stored time for display in the viewer's zone. Date-only meals keep their calendar date. */
export function toViewerTime(
  plan: { date: string; localTime: string | null; timeZone: string; instant: string | null },
  viewerZone: string,
): DisplayTime {
  if (!plan.localTime || !plan.instant) {
    return { date: plan.date, time: null, originDetail: null };
  }
  const local = DateTime.fromISO(plan.instant, { zone: 'UTC' }).setZone(viewerZone);
  const viewerOffset = local.offset;
  const originOffset = DateTime.fromISO(plan.instant, { zone: 'UTC' }).setZone(plan.timeZone).offset;
  const sameWallClock = plan.timeZone === viewerZone || viewerOffset === originOffset;
  return {
    date: local.toISODate() ?? plan.date,
    time: local.toFormat('HH:mm'),
    originDetail: sameWallClock ? null : `原时间 ${plan.date} ${plan.localTime}（${plan.timeZone}）`,
  };
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days }).toISODate() ?? date;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function formatDateLabel(date: string): string {
  const dt = DateTime.fromISO(date, { zone: 'UTC' });
  if (!dt.isValid) return date;
  return `${dt.month}月${dt.day}日 周${WEEKDAYS[dt.weekday - 1]}`;
}

export function weekdayShort(date: string): string {
  const dt = DateTime.fromISO(date, { zone: 'UTC' });
  return dt.isValid ? `周${WEEKDAYS[dt.weekday - 1]}` : '';
}

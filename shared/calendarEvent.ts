import { CALENDAR_EVENT_MINUTES } from './constants.js';
import { isSafeExternalUrl } from './restaurant.js';
import { addDays, isPastDate, isValidDateString } from './time.js';
import type { Plan } from './types.js';
import { formatLocation, OUTING_STANDARD_LABEL, outingKind } from './venue.js';

/**
 * One saved meal as a calendar event, shared by the Google Calendar link (browser) and the .ics
 * download (server) so both describe exactly the same event. Pure: no clock, no catalog, no host
 * time zone — everything comes from the frozen plan.
 *
 * - Timed meals start at the stored instant and last CALENDAR_EVENT_MINUTES, computed on absolute
 *   time, so midnight and DST changes cannot shift or stretch them. Times are written in UTC; the
 *   meal's own zone is named in the description (and passed to Google as ctz).
 * - Meals without a time are all-day events on their calendar date (end = next day, exclusive).
 * - UID is stable per plan, SEQUENCE is the plan version and DTSTAMP is the plan's updatedAt, so a
 *   re-export of the same version is byte-identical and reading never writes anything.
 * - No reminders (VALARM): the target calendar's defaults apply. Shopping statuses are never included.
 */

export type CalendarPlan = Pick<
  Plan,
  | 'id'
  | 'shortId'
  | 'status'
  | 'version'
  | 'date'
  | 'mealLabel'
  | 'localTime'
  | 'timeZone'
  | 'instant'
  | 'mode'
  | 'note'
  | 'purpose'
  | 'dishes'
  | 'selectedRestaurant'
  | 'updatedAt'
>;

export type CalendarTiming =
  | { allDay: true; /** YYYYMMDD */ startDate: string; /** YYYYMMDD, exclusive */ endDate: string }
  | { allDay: false; /** YYYYMMDDTHHMMSSZ */ start: string; end: string };

export interface CalendarEvent {
  uid: string;
  sequence: number;
  /** YYYYMMDDTHHMMSSZ */
  stamp: string;
  title: string;
  description: string;
  location: string;
  /** Link back to the plan; '' when it is not a safe http(s) URL. */
  url: string;
  timeZone: string;
  timing: CalendarTiming;
}

/** cancelled = no export; past = one-off export of a read-only meal; upcoming = normal. */
export type CalendarExportState = 'upcoming' | 'past' | 'cancelled';

export function calendarExportState(plan: Pick<Plan, 'status' | 'date' | 'timeZone'>, now: Date): CalendarExportState {
  if (plan.status !== 'active') return 'cancelled';
  return isPastDate(plan.date, plan.timeZone, now) ? 'past' : 'upcoming';
}

/** CRLF, CR and the Unicode line/paragraph separators (U+2028, U+2029). */
const LINE_BREAKS = new RegExp(`\\r\\n?|[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

/** Multi-line text without control characters (line breaks normalized to \n). */
export function cleanCalendarText(value: string): string {
  return value
    .replace(LINE_BREAKS, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
}

/** Single-line text: every kind of line break or run of whitespace becomes one space. */
const oneLine = (value: string): string => cleanCalendarText(value).replace(/\s+/g, ' ');

/** ISO instant → YYYYMMDDTHHMMSSZ (UTC), or null when it does not parse. */
function utcStamp(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

const compactDate = (date: string): string => date.replace(/-/g, '');

function timingOf(plan: CalendarPlan): CalendarTiming {
  const startMs = plan.localTime && plan.instant ? Date.parse(plan.instant) : Number.NaN;
  const start = utcStamp(startMs);
  const end = utcStamp(startMs + CALENDAR_EVENT_MINUTES * 60_000);
  if (start && end) return { allDay: false, start, end };
  return { allDay: true, startDate: compactDate(plan.date), endDate: compactDate(addDays(plan.date, 1)) };
}

function titleOf(plan: CalendarPlan): string {
  const kind = outingKind(plan);
  const where = kind === 'home' ? '在家吃' : oneLine(plan.selectedRestaurant?.name ?? '') || OUTING_STANDARD_LABEL[kind];
  return `${oneLine(plan.mealLabel) || (kind === 'treat' ? OUTING_STANDARD_LABEL.treat : '用餐')} · ${where}`;
}

function locationOf(plan: CalendarPlan): string {
  if (plan.mode === 'home') return '在家';
  const r = plan.selectedRestaurant;
  return oneLine(r?.address ?? '') || oneLine(r?.name ?? '');
}

function descriptionOf(plan: CalendarPlan, planUrl: string): string {
  const lines: string[] = [];
  if (plan.mode === 'home') {
    const names = plan.dishes.map((d) => oneLine(d.name)).filter(Boolean);
    lines.push(`在家吃：${names.join('、') || '（未选菜）'}`);
  } else {
    const r = plan.selectedRestaurant;
    lines.push(`${outingKind(plan) === 'treat' ? '饮品甜品' : '餐厅'}：${oneLine(r?.name ?? '') || '（未定）'}`);
    const where = oneLine(formatLocation(r?.location));
    if (where) lines.push(`地区：${where}`);
    if (r?.address) lines.push(`地址：${oneLine(r.address)}`);
    if (r?.mapUrl && isSafeExternalUrl(r.mapUrl)) lines.push(`地图：${r.mapUrl}`);
  }
  lines.push(
    plan.localTime && plan.instant
      ? `时间：${plan.date} ${plan.localTime}（${plan.timeZone}）`
      : `日期：${plan.date} 全天（${plan.timeZone}）`,
  );
  const note = cleanCalendarText(plan.note);
  if (note) lines.push(`备注：${note}`);
  if (planUrl) lines.push(`计划详情：${planUrl}`);
  lines.push(`编号 #${oneLine(plan.shortId)} · 第 ${plan.version} 版`);
  lines.push('在 Bistro Express 里修改或取消这一餐不会同步到日历，请手动调整日程。');
  return lines.join('\n');
}

/** Builds the event from the saved plan. `planUrl` is the absolute link to the plan detail page. */
export function buildCalendarEvent(plan: CalendarPlan, planUrl: string): CalendarEvent {
  const url = isSafeExternalUrl(planUrl) ? planUrl : '';
  const stamp = utcStamp(Date.parse(plan.updatedAt)) ?? `${compactDate(isValidDateString(plan.date) ? plan.date : '1970-01-01')}T000000Z`;
  return {
    uid: `${plan.id}@bistro-express`,
    sequence: plan.version,
    stamp,
    title: titleOf(plan),
    description: descriptionOf(plan, url),
    location: locationOf(plan),
    url,
    timeZone: plan.timeZone,
    timing: timingOf(plan),
  };
}

const GOOGLE_TEMPLATE = 'https://calendar.google.com/calendar/render';

/** "Add to Google Calendar" template link; the user still confirms the event in Google Calendar. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const t = event.timing;
  const dates = t.allDay ? `${t.startDate}/${t.endDate}` : `${t.start}/${t.end}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates,
    details: event.description,
    location: event.location,
    ctz: event.timeZone,
  });
  return `${GOOGLE_TEMPLATE}?${params.toString()}`;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeIcsText(value: string): string {
  return cleanCalendarText(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

const encoder = new TextEncoder();

/**
 * Folds a content line to at most 75 octets per physical line (continuations start with one
 * space, so they carry at most 74). Splits only between code points, never inside a UTF-8 sequence.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = ch;
      bytes = size;
      limit = 74;
    } else {
      current += ch;
      bytes += size;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** A complete single-event VCALENDAR with CRLF line endings. */
export function buildIcs(event: CalendarEvent): string {
  const t = event.timing;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bistro Express//Meal Plan//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${event.stamp}`,
    ...(t.allDay ? [`DTSTART;VALUE=DATE:${t.startDate}`, `DTEND;VALUE=DATE:${t.endDate}`] : [`DTSTART:${t.start}`, `DTEND:${t.end}`]),
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** ASCII-only download name, e.g. bistro-AB12CD.ics. */
export function icsFileName(shortId: string): string {
  const safe = shortId.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  return `bistro-${safe || 'meal'}.ics`;
}

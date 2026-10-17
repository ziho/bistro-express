import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCalendarEvent,
  buildIcs,
  calendarExportState,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  icsFileName,
  type CalendarPlan,
} from '../shared/calendarEvent.js';
import { resolveLocalDateTime } from '../shared/time.js';
import type { DishSnapshot, RestaurantSnapshot } from '../shared/types.js';

const PLAN_URL = 'https://public.test/bistro/plans/11111111-2222-4333-8444-555555555555';

const dish = (name: string): DishSnapshot => ({
  id: name,
  name,
  category: '',
  sections: [],
  imageAssetId: null,
  tags: [],
  description: '',
  recipeUrl: null,
  ingredients: [{ name: '鸡蛋', quantity: '2颗', purchaseNote: '' }],
  totalMinutes: null,
  activeMinutes: null,
  servingText: '',
  shoppingNote: '',
});

const restaurant = (extra: Partial<RestaurantSnapshot> = {}): RestaurantSnapshot => ({
  id: 'r1',
  name: '面馆',
  imageAssetId: null,
  review: '',
  tags: [],
  budgetText: '',
  address: '幸福路 1 号',
  mapUrl: 'https://maps.app.goo.gl/abc',
  links: [],
  ...extra,
});

function timedPlan(date: string, time: string, zone: string, extra: Partial<CalendarPlan> = {}): CalendarPlan {
  const resolved = resolveLocalDateTime(date, time, zone);
  if (!resolved.ok) throw new Error(resolved.reason);
  return basePlan({ date, localTime: time, timeZone: zone, instant: resolved.instant, ...extra });
}

function basePlan(extra: Partial<CalendarPlan> = {}): CalendarPlan {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    shortId: 'AB23CD',
    status: 'active',
    version: 3,
    date: '2030-01-20',
    mealLabel: '晚餐',
    localTime: null,
    timeZone: 'Asia/Shanghai',
    instant: null,
    mode: 'home',
    note: '',
    dishes: [dish('番茄炒蛋'), dish('鸡蛋汤')],
    selectedRestaurant: null,
    updatedAt: '2030-01-15T12:34:56.789Z',
    ...extra,
  };
}

/** Unfolds an .ics body into logical content lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
const prop = (ics: string, name: string) => unfold(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe('event timing', () => {
  it('uses the stored instant and exactly 60 minutes for a timed meal', () => {
    const e = buildCalendarEvent(timedPlan('2030-01-20', '18:30', 'Asia/Shanghai'), PLAN_URL);
    expect(e.timing).toEqual({ allDay: false, start: '20300120T103000Z', end: '20300120T113000Z' });
  });

  it('crosses midnight in UTC and in the meal zone without shifting the date', () => {
    const late = buildCalendarEvent(timedPlan('2030-12-31', '23:30', 'Asia/Shanghai'), PLAN_URL);
    expect(late.timing).toEqual({ allDay: false, start: '20301231T153000Z', end: '20301231T163000Z' });
    const utcLate = buildCalendarEvent(timedPlan('2030-12-31', '23:30', 'UTC'), PLAN_URL);
    expect(utcLate.timing).toEqual({ allDay: false, start: '20301231T233000Z', end: '20310101T003000Z' });
  });

  it('keeps 60 real minutes across DST changes', () => {
    // New York springs forward at 02:00 on 2030-03-10: 01:30 EST + 60 min = 03:30 EDT.
    const spring = buildCalendarEvent(timedPlan('2030-03-10', '01:30', 'America/New_York'), PLAN_URL);
    expect(spring.timing).toEqual({ allDay: false, start: '20300310T063000Z', end: '20300310T073000Z' });
    // Falls back at 02:00 on 2030-11-03: the repeated 01:30 resolves to the earlier (EDT) one.
    const fall = buildCalendarEvent(timedPlan('2030-11-03', '01:30', 'America/New_York'), PLAN_URL);
    expect(fall.timing).toEqual({ allDay: false, start: '20301103T053000Z', end: '20301103T063000Z' });
  });

  it('makes all-day events with an exclusive next-day end, including leap days and year ends', () => {
    const cases: [string, string, string][] = [
      ['2030-01-20', '20300120', '20300121'],
      ['2028-02-28', '20280228', '20280229'],
      ['2028-02-29', '20280229', '20280301'],
      ['2030-02-28', '20300228', '20300301'],
      ['2030-12-31', '20301231', '20310101'],
    ];
    for (const [date, start, end] of cases) {
      const e = buildCalendarEvent(basePlan({ date }), PLAN_URL);
      expect(e.timing, date).toEqual({ allDay: true, startDate: start, endDate: end });
      const ics = buildIcs(e);
      expect(prop(ics, 'DTSTART')).toBe(`DTSTART;VALUE=DATE:${start}`);
      expect(prop(ics, 'DTEND')).toBe(`DTEND;VALUE=DATE:${end}`);
    }
  });

  it('does not depend on the host time zone', () => {
    const plan = timedPlan('2030-03-10', '01:30', 'America/New_York');
    const allDay = basePlan({ date: '2030-12-31', timeZone: 'Pacific/Kiritimati' });
    process.env.TZ = 'Pacific/Kiritimati';
    const a = [buildIcs(buildCalendarEvent(plan, PLAN_URL)), buildIcs(buildCalendarEvent(allDay, PLAN_URL))];
    process.env.TZ = 'America/Los_Angeles';
    const b = [buildIcs(buildCalendarEvent(plan, PLAN_URL)), buildIcs(buildCalendarEvent(allDay, PLAN_URL))];
    expect(b).toEqual(a);
  });

  it('falls back to an all-day event when a time has no valid instant', () => {
    const e = buildCalendarEvent(basePlan({ localTime: '18:30', instant: 'garbage' }), PLAN_URL);
    expect(e.timing.allDay).toBe(true);
  });
});

describe('event content', () => {
  it('describes a home meal from its frozen snapshot, without shopping statuses', () => {
    const e = buildCalendarEvent(timedPlan('2030-01-20', '18:30', 'Asia/Shanghai', { note: '少放辣' }), PLAN_URL);
    expect(e.title).toBe('晚餐 · 在家吃');
    expect(e.location).toBe('在家');
    expect(e.uid).toBe('11111111-2222-4333-8444-555555555555@bistro-express');
    expect(e.sequence).toBe(3);
    expect(e.stamp).toBe('20300115T123456Z');
    expect(e.description).toContain('在家吃：番茄炒蛋、鸡蛋汤');
    expect(e.description).toContain('时间：2030-01-20 18:30（Asia/Shanghai）');
    expect(e.description).toContain('备注：少放辣');
    expect(e.description).toContain(`计划详情：${PLAN_URL}`);
    expect(e.description).not.toMatch(/待采购|家里已有|已买好|2颗/);
  });

  it('describes a restaurant meal with its address, map link and name', () => {
    const e = buildCalendarEvent(basePlan({ mode: 'restaurant', dishes: [], selectedRestaurant: restaurant() }), PLAN_URL);
    expect(e.title).toBe('晚餐 · 面馆');
    expect(e.location).toBe('幸福路 1 号');
    expect(e.description).toContain('餐厅：面馆');
    expect(e.description).toContain('地图：https://maps.app.goo.gl/abc');
    expect(e.description).toContain('日期：2030-01-20 全天（Asia/Shanghai）');
    const noAddress = buildCalendarEvent(
      basePlan({ mode: 'restaurant', dishes: [], selectedRestaurant: restaurant({ address: '', mapUrl: 'javascript:alert(1)' }) }),
      PLAN_URL,
    );
    expect(noAddress.location).toBe('面馆');
    expect(noAddress.description).not.toContain('javascript:');
  });

  it('keeps user text on one logical line per property (no CRLF injection)', () => {
    const plan = basePlan({
      mode: 'restaurant',
      dishes: [],
      mealLabel: '晚餐\r\nATTENDEE:mailto:x@evil.test',
      note: '第一行\r\nEND:VEVENT\nBEGIN:VEVENT\u0000',
      selectedRestaurant: restaurant({ name: 'A;B,C\\D\nLOCATION:evil', address: '' }),
    });
    const ics = buildIcs(buildCalendarEvent(plan, PLAN_URL));
    // The injected text survives only as escaped data inside DESCRIPTION, never as its own line.
    expect(unfold(ics).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(unfold(ics).filter((l) => l === 'END:VEVENT')).toHaveLength(1);
    expect(unfold(ics).filter((l) => l.startsWith('ATTENDEE'))).toEqual([]);
    expect(unfold(ics).filter((l) => /^(ATTENDEE|LOCATION)/.test(l))).toEqual(['LOCATION:A\\;B\\,C\\\\D LOCATION:evil']);
    expect(ics).not.toContain('\u0000');
    // Every line break in the file is a CRLF; bare CR / LF never appear.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:晚餐 ATTENDEE:mailto:x@evil.test · A\\;B\\,C\\\\D LOCATION:evil');
    expect(prop(ics, 'DESCRIPTION')).toContain('备注：第一行\\nEND:VEVENT\\nBEGIN:VEVENT\\n');
  });

  it('escapes TEXT values per RFC 5545', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
  });
});

describe('.ics file', () => {
  const ics = buildIcs(buildCalendarEvent(timedPlan('2030-01-20', '18:30', 'Asia/Shanghai'), PLAN_URL));

  it('is one CRLF-terminated VEVENT with stable UID, SEQUENCE and DTSTAMP and no alarm', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(prop(ics, 'UID')).toBe('UID:11111111-2222-4333-8444-555555555555@bistro-express');
    expect(prop(ics, 'SEQUENCE')).toBe('SEQUENCE:3');
    expect(prop(ics, 'DTSTAMP')).toBe('DTSTAMP:20300115T123456Z');
    expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300120T103000Z');
    expect(prop(ics, 'DTEND')).toBe('DTEND:20300120T113000Z');
    expect(prop(ics, 'URL')).toBe(`URL:${PLAN_URL}`);
    expect(ics).not.toContain('VALARM');
    expect(ics).not.toContain('VTIMEZONE');
    // Deterministic: the same plan version exports byte-identical files.
    expect(buildIcs(buildCalendarEvent(timedPlan('2030-01-20', '18:30', 'Asia/Shanghai'), PLAN_URL))).toBe(ics);
  });

  it('folds every physical line to at most 75 octets without splitting UTF-8 characters', () => {
    const plan = basePlan({ note: '很长的备注🍜'.repeat(40) + 'ascii,;\\'.repeat(20), dishes: Array.from({ length: 30 }, (_, i) => dish(`第${i}道菜`)) });
    const long = buildIcs(buildCalendarEvent(plan, PLAN_URL));
    const encoder = new TextEncoder();
    for (const line of long.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      // A split surrogate pair would show up as a lone surrogate.
      expect(line).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(long.split('\r\n').some((l) => l.startsWith(' '))).toBe(true);
    // Unfolding restores the exact escaped description.
    expect(prop(long, 'DESCRIPTION')).toBe(`DESCRIPTION:${escapeIcsText(buildCalendarEvent(plan, PLAN_URL).description)}`);
  });

  it('folds at exactly 75 octets and keeps short lines intact', () => {
    expect(foldIcsLine('A'.repeat(75))).toBe('A'.repeat(75));
    expect(foldIcsLine('A'.repeat(76))).toBe(`${'A'.repeat(75)}\r\n A`);
    // 25 three-octet characters = 75 octets; the 26th moves to a continuation line.
    expect(foldIcsLine('汉'.repeat(26))).toBe(`${'汉'.repeat(25)}\r\n 汉`);
    expect(foldIcsLine(`${'A'.repeat(74)}汉`)).toBe(`${'A'.repeat(74)}\r\n 汉`);
  });

  it('uses an ASCII-only file name', () => {
    expect(icsFileName('AB23CD')).toBe('bistro-AB23CD.ics');
    expect(icsFileName('"; x=测试\r\n')).toBe('bistro-x.ics');
    expect(icsFileName('')).toBe('bistro-meal.ics');
  });
});

describe('Google Calendar link', () => {
  it('describes exactly the same event as the .ics file', () => {
    for (const plan of [
      timedPlan('2030-03-10', '01:30', 'America/New_York', { note: 'a&b=c #d\n第二行' }),
      basePlan({ date: '2028-02-29', mode: 'restaurant', dishes: [], selectedRestaurant: restaurant({ name: '面馆 & 酒+吧' }) }),
    ]) {
      const event = buildCalendarEvent(plan, PLAN_URL);
      const url = new URL(googleCalendarUrl(event));
      const ics = buildIcs(event);
      expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
      expect(url.searchParams.get('action')).toBe('TEMPLATE');
      const [start, end] = url.searchParams.get('dates')!.split('/');
      expect(prop(ics, 'DTSTART')!.split(':')[1]).toBe(start);
      expect(prop(ics, 'DTEND')!.split(':')[1]).toBe(end);
      expect(url.searchParams.get('text')).toBe(event.title);
      expect(url.searchParams.get('details')).toBe(event.description);
      expect(url.searchParams.get('location')).toBe(event.location);
      expect(url.searchParams.get('ctz')).toBe(plan.timeZone);
      expect(prop(ics, 'SUMMARY')).toBe(`SUMMARY:${escapeIcsText(event.title)}`);
    }
  });

  it('uses UTC timestamps for timed meals and date pairs for all-day meals', () => {
    const timed = new URL(googleCalendarUrl(buildCalendarEvent(timedPlan('2030-01-20', '18:30', 'Asia/Shanghai'), PLAN_URL)));
    expect(timed.searchParams.get('dates')).toBe('20300120T103000Z/20300120T113000Z');
    const allDay = new URL(googleCalendarUrl(buildCalendarEvent(basePlan({ date: '2030-12-31' }), PLAN_URL)));
    expect(allDay.searchParams.get('dates')).toBe('20301231/20310101');
  });
});

describe('export state', () => {
  it('is cancelled, past (by the meal zone) or upcoming', () => {
    const plan = basePlan({ date: '2030-01-16' });
    expect(calendarExportState({ ...plan, status: 'cancelled' }, new Date('2030-01-15T00:00:00Z'))).toBe('cancelled');
    expect(calendarExportState(plan, new Date('2030-01-16T15:59:00Z'))).toBe('upcoming');
    expect(calendarExportState(plan, new Date('2030-01-16T16:01:00Z'))).toBe('past');
  });
});

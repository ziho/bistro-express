import { afterEach, describe, expect, it } from 'vitest';
import type { Plan } from '../shared/types.js';
import { groupByViewerDate, upcomingActiveDays } from '../web/src/lib/agenda.js';
import {
  clampDate,
  fullDateLabel,
  monthGrid,
  moveByKey,
  parseDateEntry,
  shortDateLabel,
  withMonth,
} from '../web/src/lib/calendar.js';
import { mergeImport } from '../web/src/lib/mapImport.js';

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

describe('month calendar helpers', () => {
  it('lays out Monday-first weeks containing every day exactly once', () => {
    const weeks = monthGrid({ year: 2026, month: 10 }); // 1 Oct 2026 is a Thursday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]!.slice(0, 4)).toEqual([null, null, null, '2026-10-01']);
    const days = weeks.flat().filter(Boolean);
    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(monthGrid({ year: 2027, month: 2 })).toHaveLength(4); // starts on a Monday, 28 days
  });

  it('never shifts date-only strings with the browser time zone', () => {
    const snapshot = () => [
      monthGrid({ year: 2030, month: 3 })[0],
      fullDateLabel('2030-03-31'),
      moveByKey('2030-03-31', 'ArrowRight'),
      parseDateEntry('2030年3月31日'),
    ];
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
    const east = snapshot();
    process.env.TZ = 'Pacific/Pago_Pago'; // UTC-11
    const west = snapshot();
    expect(east).toEqual(west);
    expect(east[1]).toBe('2030年3月31日 星期日');
    expect(east[2]).toBe('2030-04-01');
  });

  it('labels days in full and shows the year only when it differs', () => {
    expect(fullDateLabel('2026-10-16')).toBe('2026年10月16日 星期五');
    expect(shortDateLabel('2026-12-25', '2026-10-16')).toBe('12月25日 周五');
    expect(shortDateLabel('2027-03-05', '2026-10-16')).toBe('2027年3月5日 周五');
  });

  it('moves with the keyboard like the WAI-ARIA date picker', () => {
    expect(moveByKey('2026-10-16', 'ArrowUp')).toBe('2026-10-09');
    expect(moveByKey('2026-10-16', 'Home')).toBe('2026-10-12'); // Monday
    expect(moveByKey('2026-10-16', 'End')).toBe('2026-10-18'); // Sunday
    expect(moveByKey('2027-01-31', 'PageDown')).toBe('2027-02-28');
    expect(moveByKey('2028-02-29', 'PageDown', true)).toBe('2029-02-28');
    expect(withMonth('2026-10-31', { year: 2026, month: 11 })).toBe('2026-11-30');
  });

  it('keeps past days unreachable', () => {
    expect(clampDate(moveByKey('2026-10-16', 'PageUp'), '2026-10-16')).toBe('2026-10-16');
    expect(clampDate('2031-01-01', '2026-10-16')).toBe('2031-01-01');
  });

  it('accepts common typed date formats for distant days and rejects impossible dates', () => {
    for (const text of ['2031-07-04', '2031/7/4', '2031.07.04', '2031年7月4日', ' 20310704 ']) {
      expect(parseDateEntry(text)).toBe('2031-07-04');
    }
    for (const text of ['2031-02-30', '7/4/2031', '明天', '', '2031-13-01']) expect(parseDateEntry(text)).toBeNull();
  });
});

function plan(id: string, date: string, status: Plan['status'] = 'active'): Plan {
  return {
    id,
    shortId: id,
    status,
    version: 1,
    date,
    mealLabel: '晚餐',
    localTime: null,
    timeZone: 'Asia/Shanghai',
    instant: null,
    mode: 'home',
    note: '',
    dishes: [],
    candidates: [],
    selectedRestaurant: null,
    sourcePlanId: null,
    createdAt: '',
    updatedAt: '',
    cancelledAt: null,
    notification: null,
  };
}

describe('home agenda', () => {
  it('marks every future date with an active plan, not only the first ten', () => {
    const plans = Array.from({ length: 14 }, (_, i) => plan(`p${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`));
    plans.push(plan('far', '2028-05-20'), plan('gone', '2026-10-01'), plan('cancelled', '2026-12-24', 'cancelled'));
    const days = upcomingActiveDays(groupByViewerDate(plans), '2026-10-16').map(([d]) => d);
    expect(days).toHaveLength(15);
    expect(days).toContain('2028-05-20');
    expect(days).not.toContain('2026-10-01');
    expect(days).not.toContain('2026-12-24');
  });
});

describe('map link import merge', () => {
  const empty = { name: '', mapUrl: '' };

  it('fills empty fields and remembers what it filled', () => {
    const m = mergeImport(empty, {}, { name: 'Katsu San Richmond', mapUrl: 'https://www.google.com/maps/place/x' });
    expect(m.updates).toEqual({ name: 'Katsu San Richmond', mapUrl: 'https://www.google.com/maps/place/x' });
    expect(m.conflicts).toEqual([]);
  });

  it('never overwrites a field the admin typed; reports it for an explicit replace', () => {
    const m = mergeImport({ name: '我家楼下炸猪排', mapUrl: '' }, {}, { name: 'Katsu San Richmond', mapUrl: 'https://m/1' });
    expect(m.updates).toEqual({ mapUrl: 'https://m/1' });
    expect(m.conflicts).toEqual([{ field: 'name', current: '我家楼下炸猪排', incoming: 'Katsu San Richmond' }]);
  });

  it('replaces its own untouched earlier result on a repeated resolve, but not after the admin edits it', () => {
    const first = mergeImport(empty, {}, { name: 'A', mapUrl: 'https://m/a' });
    const again = mergeImport({ name: 'A', mapUrl: 'https://m/a' }, first.autofilled, { name: 'B', mapUrl: 'https://m/b' });
    expect(again.updates).toEqual({ name: 'B', mapUrl: 'https://m/b' });
    const edited = mergeImport({ name: 'A 改过', mapUrl: 'https://m/a' }, first.autofilled, { name: 'B', mapUrl: null });
    expect(edited.updates).toEqual({});
    expect(edited.conflicts.map((c) => c.field)).toEqual(['name']);
  });

  it('missing results never clear existing input', () => {
    const m = mergeImport({ name: '手填', mapUrl: 'https://m/x' }, {}, { name: null, mapUrl: null });
    expect(m).toEqual({ updates: {}, autofilled: {}, conflicts: [] });
  });
});

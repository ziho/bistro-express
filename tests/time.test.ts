import { describe, expect, it } from 'vitest';
import { isPastDate, resolveLocalDateTime, todayInZone, toViewerTime } from '../shared/time.js';

describe('shared time helpers', () => {
  it('computes today per zone', () => {
    const now = new Date('2030-01-15T23:30:00Z');
    expect(todayInZone('UTC', now)).toBe('2030-01-15');
    expect(todayInZone('Asia/Shanghai', now)).toBe('2030-01-16');
    expect(todayInZone('America/Los_Angeles', now)).toBe('2030-01-15');
    expect(isPastDate('2030-01-15', 'Asia/Shanghai', now)).toBe(true);
    expect(isPastDate('2030-01-15', 'America/Los_Angeles', now)).toBe(false);
  });

  it('handles DST gaps and overlaps', () => {
    expect(resolveLocalDateTime('2030-03-31', '02:30', 'Europe/Berlin')).toEqual({ ok: false, reason: 'nonexistent_time' });
    const overlap = resolveLocalDateTime('2030-10-27', '02:30', 'Europe/Berlin');
    expect(overlap).toMatchObject({ ok: true, ambiguous: true, instant: '2030-10-27T00:30:00Z' });
    expect(resolveLocalDateTime('2030-01-01', '12:00', 'Nowhere/Zone')).toEqual({ ok: false, reason: 'invalid_zone' });
  });

  it('converts timed meals to the viewer zone and keeps date-only meals on their date', () => {
    const timed = { date: '2030-03-01', localTime: '19:30', timeZone: 'America/New_York', instant: '2030-03-02T00:30:00Z' };
    expect(toViewerTime(timed, 'Asia/Shanghai')).toEqual({
      date: '2030-03-02',
      time: '08:30',
      originDetail: '原时间 2030-03-01 19:30（America/New_York）',
    });
    expect(toViewerTime(timed, 'America/New_York')).toEqual({ date: '2030-03-01', time: '19:30', originDetail: null });
    const dateOnly = { date: '2030-03-01', localTime: null, timeZone: 'America/New_York', instant: null };
    expect(toViewerTime(dateOnly, 'Asia/Tokyo')).toEqual({ date: '2030-03-01', time: null, originDetail: null });
  });
});

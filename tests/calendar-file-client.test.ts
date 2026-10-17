import { describe, expect, it, vi } from 'vitest';
import { fetchCalendarFile } from '../web/src/lib/calendarFile';
const body = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const fetcher = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);

describe('calendar file handoff', () => {
  it('downloads privately and preserves CRLF for the calendar application', async () => {
    const f = fetcher(new Response(body, { headers: { 'content-type': 'text/calendar; charset=utf-8' } }));
    const blob = await fetchCalendarFile('fixture-id', { fetcher: f });
    expect(await blob.text()).toBe(body);
    expect(blob.type).toBe('text/calendar;charset=utf-8');
    expect(f).toHaveBeenCalledWith('/bistro/api/plans/fixture-id/calendar.ics', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store', headers: { accept: 'text/calendar' },
    }));
  });
  it('uses the normal gate flow on an expired session instead of handing off JSON as a file', async () => {
    const onUnauthorized = vi.fn();
    await expect(fetchCalendarFile('id', {
      fetcher: fetcher(Response.json({ error: { code: 'unauthorized', message: '请先验证日期' } }, { status: 401 })),
      onUnauthorized,
    })).rejects.toMatchObject({ status: 401, code: 'unauthorized', message: '请先验证日期' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
  it('keeps cancellation and proxy failures actionable on the meal page', async () => {
    await expect(fetchCalendarFile('id', {
      fetcher: fetcher(Response.json({ error: { code: 'calendar_unavailable', message: '这一餐已经取消' } }, { status: 422 })),
    })).rejects.toMatchObject({ code: 'calendar_unavailable', message: '这一餐已经取消' });
    await expect(fetchCalendarFile('id', { fetcher: fetcher(new Response('Bad gateway', { status: 503 })) }))
      .rejects.toMatchObject({ status: 503 });
  });
  it('refuses HTML shells and incomplete files even when an upstream returns 200', async () => {
    await expect(fetchCalendarFile('id', { fetcher: fetcher(new Response('<html/>', { headers: { 'content-type': 'text/html' } })) }))
      .rejects.toMatchObject({ code: 'invalid_calendar' });
    await expect(fetchCalendarFile('id', { fetcher: fetcher(new Response('BEGIN:VCALENDAR\r\n', { headers: { 'content-type': 'text/calendar' } })) }))
      .rejects.toMatchObject({ code: 'invalid_calendar' });
  });
  it('reports network failure without a successful-file result', async () => {
    await expect(fetchCalendarFile('id', { fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')) }))
      .rejects.toMatchObject({ status: 0, code: 'network' });
  });
});

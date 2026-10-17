import { API_PATH } from '../../../shared/constants';
import { ApiError, UNAUTHORIZED_EVENT } from '../api/client';

interface CalendarFileOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  onUnauthorized?: () => void;
}

/** Fetch before starting a file download so HTTP errors stay in the meal page, with the usual gate flow. */
export async function fetchCalendarFile(planId: string, opts: CalendarFileOptions = {}): Promise<Blob> {
  let res: Response;
  try {
    res = await (opts.fetcher ?? fetch)(API_PATH + '/plans/' + encodeURIComponent(planId) + '/calendar.ics', {
      credentials: 'same-origin', cache: 'no-store', signal: opts.signal,
      headers: { accept: 'text/calendar' },
    });
  } catch {
    throw new ApiError(0, 'network', '网络好像断开了，请稍后重试下载');
  }
  if (!res.ok) {
    let error: { code?: string; message?: string } | undefined;
    try { error = (await res.json() as { error?: typeof error }).error; } catch { /* Non-JSON proxy error. */ }
    if (res.status === 401) {
      (opts.onUnauthorized ?? (() => window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))))();
    }
    throw new ApiError(res.status, error?.code ?? 'http_error', error?.message ?? '日历文件下载失败，请重试');
  }
  if (res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'text/calendar') {
    throw new ApiError(502, 'invalid_calendar', '服务器没有返回日历文件，请重试');
  }
  const text = await res.text();
  if (!text.startsWith('BEGIN:VCALENDAR\r\n') || !text.endsWith('END:VCALENDAR\r\n')) {
    throw new ApiError(502, 'invalid_calendar', '日历文件不完整，请重试');
  }
  return new Blob([text], { type: 'text/calendar;charset=utf-8' });
}

/** A file handoff, not evidence that the target calendar saved the event. */
export function offerCalendarDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Leave enough time for Safari's download handoff before releasing the blob URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

import { CalendarPlus, Download, ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { buildCalendarEvent, calendarExportState, googleCalendarUrl, icsFileName } from '../../../shared/calendarEvent';
import { BASE_PATH, CALENDAR_EVENT_MINUTES } from '../../../shared/constants';
import type { Plan } from '../../../shared/types';
import { fetchCalendarFile, offerCalendarDownload } from '../lib/calendarFile';
import { useOnline } from '../lib/hooks';

type Opened = 'google' | 'ics' | null;

const OPENED_TEXT: Record<Exclude<Opened, null>, string> = {
  google: '已打开 Google 日历。请在那里确认保存，这里无法知道是否已添加。',
  ics: '日历文件已准备好。请在日历应用里打开并确认，这里无法知道是否已添加。',
};

/**
 * 添加到日历 for one saved, active meal. The Google link and the .ics file come from the same
 * event builder and the frozen plan; nothing is written anywhere and nothing syncs afterwards.
 * Cancelled meals show nothing; past meals can still be exported once, clearly read-only.
 */
export function PlanCalendar({ plan }: { plan: Plan }) {
  const online = useOnline();
  const [opened, setOpened] = useState<Opened>(null);
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setDownloading(false);
    setProblem('');
    setOpened(null);
    return () => { request.current?.abort(); request.current = null; };
  }, [plan.id]);
  const download = async () => {
    if (!online || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setDownloading(true);
    setProblem('');
    setOpened(null);
    try {
      const blob = await fetchCalendarFile(plan.id, { signal: controller.signal });
      if (!controller.signal.aborted) {
        offerCalendarDownload(blob, icsFileName(plan.shortId));
        setOpened('ics');
      }
    } catch (err) {
      if (!controller.signal.aborted) setProblem(err instanceof Error ? err.message : '日历文件下载失败，请重试');
    } finally {
      if (request.current === controller) { request.current = null; setDownloading(false); }
    }
  };
  const state = calendarExportState(plan, new Date());
  if (state === 'cancelled') return null;

  const planUrl = `${window.location.origin}${BASE_PATH}/plans/${plan.id}`;
  const event = buildCalendarEvent(plan, planUrl);
  const timed = !event.timing.allDay;

  return (
    <section className="card cal-export" aria-labelledby="calendar-title">
      <h2 id="calendar-title" className="section-title">
        <CalendarPlus aria-hidden="true" />
        添加到日历
      </h2>
      {state === 'past' && <p className="notice notice-sky small">这一餐已经过去，只能导出一份记录；计划本身仍是只读的。</p>}
      <div className="cal-export-actions">
        <a className="btn btn-ghost" href={googleCalendarUrl(event)} target="_blank" rel="noopener noreferrer" onClick={() => setOpened('google')}>
          <ExternalLink aria-hidden="true" />
          Google 日历
          <span className="sr-only">（新窗口打开）</span>
        </a>
        <button type="button" className="btn btn-ghost" disabled={!online || downloading} onClick={() => void download()}>
          <Download aria-hidden="true" />
          {downloading ? '准备日历文件…' : 'Apple / 其他日历（.ics）'}
        </button>
      </div>
      <p className="small cal-export-status" role="status" aria-live="polite">
        {opened ? OPENED_TEXT[opened] : ''}
      </p>
      {problem && <p className="notice notice-butter small" role="alert">{problem}。可以再次点击下载。</p>}
      {!online && <p className="muted small">现在离线，恢复网络后才能下载日历文件。</p>}
      <p className="muted small">
        {timed
          ? `按这一餐保存时的时间（${plan.localTime}，${plan.timeZone}）添加，时长 ${CALENDAR_EVENT_MINUTES} 分钟。`
          : `没有具体时间，会添加为 ${plan.date} 的全天日程（${plan.timeZone}）。`}
        提醒使用日历自己的默认设置。之后在这里修改或取消不会同步到日历，请手动调整；重复添加可能产生重复日程。
      </p>
    </section>
  );
}

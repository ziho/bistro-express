import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronLeft, ChevronRight, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NOTIFICATION_HISTORY } from '../../../shared/constants';
import { historyQuery, parsePageParam } from '../../../shared/notificationHistory';
import type { AdminDelivery, AdminNotification, DeliveryStatus, NotificationPage } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { Loading } from '../components/Loading';
import { NotificationBadge } from '../components/NotificationBadge';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';

const EVENT_LABEL = { created: '新建', updated: '修改', cancelled: '取消' } as const;

const DELIVERY_LABEL: Record<DeliveryStatus, { text: string; tone: string }> = {
  pending: { text: '排队中', tone: 'wait' },
  sending: { text: '发送中', tone: 'wait' },
  sent: { text: '已交给推送服务', tone: 'ok' },
  failed: { text: '发送失败', tone: 'bad' },
  skipped: { text: '已跳过', tone: 'off' },
  superseded: { text: '不再发送', tone: 'off' },
};

const PAGE_SIZE = NOTIFICATION_HISTORY.defaultPageSize;
/** Every notification query starts with this prefix, so invalidating it refreshes the overview tile too. */
const NOTIFICATIONS_KEY = ['admin', 'notifications'] as const;
const pageKey = (page: number) => [...NOTIFICATIONS_KEY, 'page', page, PAGE_SIZE] as const;

const isHeld = (n: AdminNotification) => n.status === 'failed' || n.status === 'unconfigured';
const shortTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fullTime = (iso: string) => new Date(iso).toLocaleString('zh-CN');

/** One row per recipient device: who got it, who is retrying, and why one did not. */
function DeliveryList({ deliveries }: { deliveries: AdminDelivery[] }) {
  return (
    <ul className="delivery-list" aria-label="各设备送达情况">
      {deliveries.map((d) => {
        const label = DELIVERY_LABEL[d.status];
        const retrying = d.status === 'pending' && d.attempts > 0;
        return (
          <li key={d.targetId} className="delivery-row">
            <span className="delivery-name">{d.label}</span>
            <span className={`badge badge-${label.tone}`}>{retrying ? '重试中' : label.text}</span>
            <span className="muted small">
              尝试 {d.attempts} 次{d.sentAt && ` · ${fullTime(d.sentAt)}`}
              {retrying && d.nextAttemptAt && ` · 下次 ${new Date(d.nextAttemptAt).toLocaleTimeString('zh-CN')}`}
            </span>
            {d.lastError && d.status !== 'sent' && <span className="field-error delivery-error">{d.lastError}</span>}
          </li>
        );
      })}
    </ul>
  );
}

interface RetryProps {
  notification: AdminNotification;
  disabled: boolean;
  onRetry: (id: string) => void;
}

function RetryButton({ notification: n, disabled, onRetry }: RetryProps) {
  const partial = n.delivery !== null && n.delivery.sent > 0;
  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(n.id)} disabled={disabled}>
      <RotateCcw aria-hidden="true" /> {partial ? '重试未送达的设备' : '重试'}
    </button>
  );
}

/** Progressive disclosure: device states, errors and the message text only when asked for. */
function NotificationDetail({ notification: n, retryDisabled, onRetry }: Omit<RetryProps, 'disabled'> & { retryDisabled: boolean }) {
  return (
    <div className="notif-detail">
      <div className="notif-detail-head" aria-live="polite">
        <NotificationBadge notification={n} />
        <Link to={`/plans/${n.planId}`} className="notif-detail-plan">
          #{n.planShortId} · 第 {n.planVersion} 版
        </Link>
      </div>
      <dl className="notif-detail-facts">
        <dt>类型</dt>
        <dd>{EVENT_LABEL[n.event]}</dd>
        <dt>创建</dt>
        <dd>{fullTime(n.createdAt)}</dd>
        {n.sentAt && (
          <>
            <dt>送出</dt>
            <dd>{fullTime(n.sentAt)}</dd>
          </>
        )}
        {n.status === 'pending' && n.nextAttemptAt && (
          <>
            <dt>下次尝试</dt>
            <dd>{new Date(n.nextAttemptAt).toLocaleTimeString('zh-CN')}</dd>
          </>
        )}
      </dl>
      {n.deliveries.length > 0 ? (
        <DeliveryList deliveries={n.deliveries} />
      ) : (
        n.lastError && <p className="field-error">{n.lastError}</p>
      )}
      <details className="notif-detail-body">
        <summary>推送内容</summary>
        <p className="muted small pre-wrap">{n.body}</p>
      </details>
      <p className="muted small">
        「已交给推送服务」只表示推送服务接收了消息，不代表已读。每台设备单独重试，已送达的设备不会重复推送；服务重启时正在发送的那一台可能收到重复消息。
      </p>
      {isHeld(n) && <RetryButton notification={n} disabled={retryDisabled} onRetry={onRetry} />}
    </div>
  );
}

interface RowProps {
  notification: AdminNotification;
  /** Placeholder (previous page) data is shown: its rows are not actionable. */
  stale: boolean;
  retryDisabled: boolean;
  onOpen: (n: AdminNotification) => void;
  onRetry: (id: string) => void;
}

function NotificationRow({ notification: n, stale, retryDisabled, onOpen, onRetry }: RowProps) {
  return (
    <li className="notif-row">
      <button type="button" className="notif-row-main" onClick={() => onOpen(n)} disabled={stale} aria-haspopup="dialog">
        <span className="notif-row-title">{n.title}</span>
        <span className="notif-row-meta">
          <time dateTime={n.createdAt}>{shortTime(n.createdAt)}</time> · {EVENT_LABEL[n.event]} · #{n.planShortId}
        </span>
        <ChevronRight className="notif-row-disclosure" aria-hidden="true" />
      </button>
      <div className="notif-row-side">
        <NotificationBadge notification={n} />
        {isHeld(n) && (
          <button
            type="button"
            className="icon-btn notif-row-retry"
            onClick={() => onRetry(n.id)}
            disabled={stale || retryDisabled}
            aria-label={`重试：${n.title}`}
            title="重试"
          >
            <RotateCcw aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

interface PagerProps {
  page: number;
  totalPages: number;
  total: number;
  loading: boolean;
  onGo: (page: number) => void;
}

function Pager({ page, totalPages, total, loading, onGo }: PagerProps) {
  return (
    <nav className="notif-pager" aria-label="通知记录分页">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(page - 1)} disabled={page <= 1}>
        <ChevronLeft aria-hidden="true" /> 上一页
      </button>
      <p className="notif-pager-status" aria-live="polite">
        第 {page} / {totalPages} 页 · 共 {total} 条{loading && ' · 加载中…'}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onGo(page + 1)} disabled={page >= totalPages}>
        下一页 <ChevronRight aria-hidden="true" />
      </button>
    </nav>
  );
}

function useHistoryPage() {
  const [params, setParams] = useSearchParams();
  const requested = parsePageParam(params.get('page'));
  const goTo = useCallback(
    (page: number, replace = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (page <= 1) next.delete('page');
          else next.set('page', String(page));
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  return { requested, goTo };
}

export function NotificationsAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { requested, goTo } = useHistoryPage();
  const [detail, setDetail] = useState<AdminNotification | null>(null);
  const log = useQuery({
    queryKey: pageKey(requested),
    queryFn: () => api<NotificationPage>('GET', `/admin/notifications?${historyQuery(requested, PAGE_SIZE)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const data = log.data;
  const stale = log.isPlaceholderData;
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastPage = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!data || stale) return;
    const changed = lastPage.current !== null && lastPage.current !== data.page;
    lastPage.current = data.page;
    if (changed) {
      const target = listRef.current ?? headingRef.current;
      target?.scrollIntoView({ block: 'start', behavior: 'auto' });
      target?.focus({ preventScroll: true });
    }
  }, [data?.page, stale]);


  // A refresh/retention sweep may remove the open record from this page. Do not
  // keep an expired snapshot with a live retry button in the detail sheet.
  useEffect(() => {
    if (detail && data && !stale && log.isSuccess && !data.items.some((item) => item.id === detail.id)) {
      setDetail(null);
    }
  }, [detail, data, stale, log.isSuccess]);


  // The server clamps a page past the end (e.g. after old records expired): follow it in the URL.
  useEffect(() => {
    if (!data || stale || data.page === requested) return;
    queryClient.setQueryData(pageKey(data.page), data);
    goTo(data.page, true);
  }, [data, stale, requested, goTo, queryClient]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  // Only a refresh the user asked for shows feedback; the 15 s background refetch stays quiet.
  const [manualRefresh, setManualRefresh] = useState(false);
  const refreshNow = () => {
    setManualRefresh(true);
    void refresh().finally(() => setManualRefresh(false));
  };
  const onError = (err: unknown) => toast(err instanceof ApiError ? err.message : '重试失败', 'error');
  // Refresh after errors too (e.g. a record that just expired), so the list never shows stale actions.
  const retry = useMutation({
    mutationFn: (id: string) => api('POST', `/admin/notifications/${id}/retry`),
    onSuccess: () => toast('已重新排队', 'success'),
    onError,
    onSettled: refresh,
  });
  const retryAll = useMutation({
    mutationFn: () => api<{ requeued: number }>('POST', '/admin/notifications/retry-held'),
    onSuccess: (res) => toast(res.requeued ? `已重新排队 ${res.requeued} 条` : '没有需要重试的通知', 'success'),
    onError,
    onSettled: refresh,
  });
  const retrying = retry.isPending || retryAll.isPending;

  if (log.isPending) return <Loading />;
  if (!data) {
    return (
      <div className="admin-page">
        <p className="error-text">加载失败：{log.error?.message ?? '请稍后再试'}</p>
        <button type="button" className="btn btn-ghost" onClick={() => void log.refetch()}>
          <RefreshCw aria-hidden="true" /> 重新加载
        </button>
      </div>
    );
  }
  const current = detail ? (data.items.find((n) => n.id === detail.id) ?? (stale ? detail : null)) : null;
  const shownPage = stale ? requested : data.page;
  const refreshing = manualRefresh && log.isFetching;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>通知记录</h1>
          <p className="muted small">只保留最近 {data.retentionDays} 天，更早的记录会自动删除。</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={refreshNow} disabled={refreshing} aria-busy={refreshing}>
            <RefreshCw aria-hidden="true" className={refreshing ? 'notif-spin' : undefined} /> {refreshing ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn btn-butter btn-sm" onClick={() => retryAll.mutate()} disabled={data.held === 0 || retrying}>
            <RotateCcw aria-hidden="true" /> 重试全部未送出（{data.held}）
          </button>
        </div>
      </div>
      {log.isError && <p className="error-text small">刷新失败，显示的是上次的结果：{log.error.message}</p>}
      {data.total === 0 ? (
        <div className="empty-state">
          <Bell className="empty-icon" aria-hidden="true" />
          <p>最近 {data.retentionDays} 天没有通知。新建、修改或取消计划时会产生通知。</p>
        </div>
      ) : (
        <>
          <div ref={listRef} className="notification-page-content" key={data.page} aria-busy={stale} tabIndex={-1} role="region" aria-label={`第 ${data.page} 页通知列表`}>
            <ul className="notif-rows" aria-label={`第 ${data.page} 页通知`}>
              {data.items.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  stale={stale}
                  retryDisabled={retrying}
                  onOpen={setDetail}
                  onRetry={(id) => retry.mutate(id)}
                />
              ))}
            </ul>
          </div>
          <Pager page={shownPage} totalPages={data.totalPages} total={data.total} loading={stale} onGo={(page) => goTo(page)} />
        </>
      )}
      <Sheet open={current !== null} onClose={() => setDetail(null)} title={current?.title ?? '通知详情'}>
        {current && <NotificationDetail notification={current} retryDisabled={retrying} onRetry={(id) => retry.mutate(id)} />}
      </Sheet>
    </div>
  );
}

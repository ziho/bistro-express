import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, RefreshCw, RotateCcw } from 'lucide-react';
import { Link } from 'react-router';
import type { AdminNotification } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { Loading } from '../components/Loading';
import { NotificationBadge } from '../components/NotificationBadge';
import { useToast } from '../components/Toast';

const EVENT_LABEL = { created: '新建', updated: '修改', cancelled: '取消' } as const;

export function NotificationsAdmin() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const log = useQuery({
    queryKey: ['admin', 'notifications'],
    queryFn: () => api<AdminNotification[]>('GET', '/admin/notifications'),
    refetchInterval: 15_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });
  const retry = useMutation({
    mutationFn: (id: string) => api('POST', `/admin/notifications/${id}/retry`),
    onSuccess: async () => {
      toast('已重新排队', 'success');
      await refresh();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '重试失败', 'error'),
  });
  const retryAll = useMutation({
    mutationFn: () => api<{ requeued: number }>('POST', '/admin/notifications/retry-held'),
    onSuccess: async (res) => {
      toast(res.requeued ? `已重新排队 ${res.requeued} 条` : '没有需要重试的通知', 'success');
      await refresh();
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '重试失败', 'error'),
  });

  if (log.isPending) return <Loading />;
  if (log.isError) return <p className="error-text">加载失败：{log.error.message}</p>;
  const held = log.data.filter((n) => n.status === 'failed' || n.status === 'unconfigured').length;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>通知记录</h1>
          <p className="muted small">「已交给推送服务」只表示推送服务接收了消息，不代表已读。超时重试可能导致重复推送，每条都带编号和版本号。</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" /> 刷新
          </button>
          <button type="button" className="btn btn-butter" onClick={() => retryAll.mutate()} disabled={held === 0 || retryAll.isPending}>
            <RotateCcw aria-hidden="true" /> 重试全部未送出（{held}）
          </button>
        </div>
      </div>
      {log.data.length === 0 ? (
        <div className="empty-state">
          <Bell className="empty-icon" aria-hidden="true" />
          <p>还没有通知。新建、修改或取消计划时会产生通知。</p>
        </div>
      ) : (
        <ul className="notif-list">
          {log.data.map((n) => (
            <li key={n.id} className="notif-item card">
              <div className="notif-top">
                <span className="chip chip-static">{EVENT_LABEL[n.event]}</span>
                <Link to={`/plans/${n.planId}`} className="notif-plan">
                  #{n.planShortId} · 第 {n.planVersion} 版
                </Link>
                <NotificationBadge notification={n} />
              </div>
              <p className="notif-title">{n.title}</p>
              <p className="muted small pre-wrap">{n.body}</p>
              <p className="muted small">
                尝试 {n.attempts} 次 · 创建于 {new Date(n.createdAt).toLocaleString('zh-CN')}
                {n.sentAt && ` · 送出于 ${new Date(n.sentAt).toLocaleString('zh-CN')}`}
                {n.nextAttemptAt && n.status === 'pending' && ` · 下次尝试 ${new Date(n.nextAttemptAt).toLocaleTimeString('zh-CN')}`}
              </p>
              {n.lastError && <p className="field-error">{n.lastError}</p>}
              {(n.status === 'failed' || n.status === 'unconfigured') && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => retry.mutate(n.id)} disabled={retry.isPending}>
                  <RotateCcw aria-hidden="true" /> 重试
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

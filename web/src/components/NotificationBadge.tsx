import { BellOff, BellRing, Check, Clock3, RotateCcw, TriangleAlert } from 'lucide-react';
import type { NotificationStatus, NotificationSummary } from '../../../shared/types';

const LABELS: Record<NotificationStatus, { text: string; tone: string; Icon: typeof Check }> = {
  pending: { text: '通知排队中', tone: 'wait', Icon: Clock3 },
  sending: { text: '通知发送中', tone: 'wait', Icon: BellRing },
  sent: { text: '已交给推送服务', tone: 'ok', Icon: Check },
  failed: { text: '通知发送失败', tone: 'bad', Icon: TriangleAlert },
  unconfigured: { text: '通知未配置', tone: 'off', Icon: BellOff },
  superseded: { text: '已被新版本取代', tone: 'off', Icon: RotateCcw },
};

export const notificationLabel = (status: NotificationStatus) => LABELS[status].text;

/** Badge wording that accounts for multiple recipient devices. Never claims "all sent" on partial delivery. */
export function describeNotification(n: NotificationSummary): { text: string; tone: string; Icon: typeof Check } {
  const base = LABELS[n.status];
  const d = n.delivery;
  const partial = d && d.sent > 0 && d.sent < d.total ? `${d.sent}/${d.total} 台设备` : null;
  if (n.status === 'pending' && n.attempts > 0) {
    const text = partial ? `已送达 ${partial}，其余重试中` : `通知重试中（第 ${n.attempts + 1} 次）`;
    return { ...base, text };
  }
  if ((n.status === 'failed' || n.status === 'unconfigured') && partial) {
    return { text: `部分送达（${partial}）`, tone: 'wait', Icon: TriangleAlert };
  }
  if (n.status === 'unconfigured' && d && d.skipped > 0) {
    return { ...base, text: '通知暂停（设备已停用）' };
  }
  if (n.status === 'sent' && d && d.total > 1) return { ...base, text: `已交给推送服务（${d.total} 台设备）` };
  return base;
}

/**
 * Saved and notification states are shown separately. Wording deliberately never claims the
 * owner has read or accepted anything — "sent" only means the push provider accepted it.
 */
export function NotificationBadge({ notification }: { notification: NotificationSummary | null }) {
  if (!notification) return null;
  const { text, tone, Icon } = describeNotification(notification);
  return (
    <span className={`badge badge-${tone}`} title={notification.lastError ?? undefined}>
      <Icon aria-hidden="true" />
      {text}
    </span>
  );
}

export function SavedBadge({ cancelled }: { cancelled?: boolean }) {
  return cancelled ? (
    <span className="badge badge-off">已取消</span>
  ) : (
    <span className="badge badge-saved">
      <Check aria-hidden="true" />
      已保存
    </span>
  );
}

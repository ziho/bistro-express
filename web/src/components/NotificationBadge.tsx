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

/**
 * Saved and notification states are shown separately. Wording deliberately never claims the
 * owner has read or accepted anything — "sent" only means the push provider accepted it.
 */
export function NotificationBadge({ notification }: { notification: NotificationSummary | null }) {
  if (!notification) return null;
  const { text, tone, Icon } = LABELS[notification.status];
  const retrying = notification.status === 'pending' && notification.attempts > 0;
  return (
    <span className={`badge badge-${tone}`} title={notification.lastError ?? undefined}>
      <Icon aria-hidden="true" />
      {retrying ? `通知重试中（第 ${notification.attempts + 1} 次）` : text}
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

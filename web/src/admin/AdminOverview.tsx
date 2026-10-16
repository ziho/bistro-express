import { useQuery } from '@tanstack/react-query';
import { Bell, CalendarDays, ChevronRight, Settings, Store, Utensils, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { isPastDate } from '../../../shared/time';
import type { AdminNotification, BarkSettingsView, Dish, Plan, Restaurant } from '../../../shared/types';
import { api } from '../api/client';

/* Same query keys as the management pages, so their caches are shared. */
const useRestaurants = () => useQuery({ queryKey: ['admin', 'restaurant'], queryFn: () => api<Restaurant[]>('GET', '/admin/restaurants') });
const useDishes = () => useQuery({ queryKey: ['admin', 'dish'], queryFn: () => api<Dish[]>('GET', '/admin/dishes') });
const usePlans = () => useQuery({ queryKey: ['admin', 'plans'], queryFn: () => api<Plan[]>('GET', '/admin/plans') });
const useNotifications = () =>
  useQuery({ queryKey: ['admin', 'notifications'], queryFn: () => api<AdminNotification[]>('GET', '/admin/notifications') });
const useBark = () => useQuery({ queryKey: ['admin', 'bark'], queryFn: () => api<BarkSettingsView>('GET', '/admin/settings/bark') });

interface TileProps {
  to: string;
  title: string;
  Icon: LucideIcon;
  /** Short live status; null while loading or when it could not be loaded. */
  status: string | null;
  description: string;
  /** Highlights the status (something needs a look). */
  attention?: boolean;
}

function Tile({ to, title, Icon, status, description, attention }: TileProps) {
  return (
    <li>
      <Link to={to} className="overview-tile">
        <span className="overview-tile-icon" aria-hidden="true">
          <Icon />
        </span>
        <span className="overview-tile-text">
          <span className="overview-tile-title">{title}</span>
          {status && <span className={`overview-tile-status ${attention ? 'is-attention' : ''}`}>{status}</span>}
          <span className="overview-tile-desc">{description}</span>
        </span>
        <ChevronRight className="overview-tile-chevron" aria-hidden="true" />
      </Link>
    </li>
  );
}

const countActive = (items: { active: boolean }[] | undefined, unit: string) =>
  items ? `共 ${items.length} ${unit}，上架 ${items.filter((i) => i.active).length} ${unit}` : null;

function planStatus(plans: Plan[] | undefined): string | null {
  if (!plans) return null;
  const upcoming = plans.filter((p) => p.status === 'active' && !isPastDate(p.date, p.timeZone)).length;
  return upcoming ? `即将到来 ${upcoming} 个` : '暂时没有即将到来的计划';
}

function heldCount(log: AdminNotification[] | undefined): number | null {
  return log ? log.filter((n) => n.status === 'failed' || n.status === 'unconfigured').length : null;
}

function barkStatus(bark: BarkSettingsView | undefined): string | null {
  if (!bark) return null;
  if (!bark.enabled) return '未启用';
  if (!bark.configured) return '待配置';
  return `已开启 · ${bark.devices.filter((d) => d.enabled).length} 台设备`;
}

/** Management hub: where everything is, with a few real numbers from the existing lists. */
export function AdminOverview() {
  const restaurants = useRestaurants();
  const dishes = useDishes();
  const plans = usePlans();
  const notifications = useNotifications();
  const bark = useBark();
  const held = heldCount(notifications.data);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>概览</h1>
          <p className="muted small">今天想打理点什么？</p>
        </div>
      </div>
      <ul className="overview-grid">
        <Tile
          to="/admin/restaurants"
          title="餐厅"
          Icon={Store}
          status={countActive(restaurants.data, '家')}
          description="收藏想去的店，写点评、标签和菜单 / 官网链接。"
        />
        <Tile
          to="/admin/dishes"
          title="菜品"
          Icon={Utensils}
          status={countActive(dishes.data, '道')}
          description="在家做的拿手菜，配上照片和做法。"
        />
        <Tile to="/admin/plans" title="计划" Icon={CalendarDays} status={planStatus(plans.data)} description="看看接下来想吃什么。" />
        <Tile
          to="/admin/notifications"
          title="通知"
          Icon={Bell}
          status={held === null ? null : held ? `${held} 条待处理` : '暂无待重试通知'}
          attention={Boolean(held)}
          description="每次保存计划后的推送记录，可以重试。"
        />
        <Tile
          to="/admin/settings"
          title="推送设置"
          Icon={Settings}
          status={barkStatus(bark.data)}
          attention={bark.data ? bark.data.enabled && !bark.data.configured : false}
          description="Bark 服务器和接收推送的设备。"
        />
      </ul>
    </div>
  );
}

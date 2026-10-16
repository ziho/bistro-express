import { Bell, CalendarDays, Settings, Store, Utensils } from 'lucide-react';
import { Navigate, NavLink, Route, Routes } from 'react-router';
import { Logo, OfflineBanner } from '../components/AppShell';
import { BarkSettingsPage } from './BarkSettingsPage';
import { CatalogAdmin } from './CatalogAdmin';
import { NotificationsAdmin } from './NotificationsAdmin';
import { PlansAdmin } from './PlansAdmin';

const TABS = [
  { to: 'dishes', label: '菜品', Icon: Utensils },
  { to: 'restaurants', label: '餐厅', Icon: Store },
  { to: 'plans', label: '计划', Icon: CalendarDays },
  { to: 'notifications', label: '通知', Icon: Bell },
  { to: 'settings', label: '推送设置', Icon: Settings },
];

export default function AdminApp() {
  return (
    <div className="app admin">
      <a className="skip-link" href="#admin-main">
        跳到主要内容
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="回到点餐首页">
          <Logo />
          <span className="admin-tag">后台</span>
        </NavLink>
        <nav className="topnav" aria-label="后台操作">
          <NavLink to="/" className="topnav-link" end>
            <CalendarDays aria-hidden="true" />
            <span>去点餐</span>
          </NavLink>
        </nav>
      </header>
      <OfflineBanner />
      <nav className="admin-tabs" aria-label="后台分区">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={`/admin/${to}`} className="admin-tab">
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <main id="admin-main" className="main admin-main">
        <Routes>
          <Route index element={<Navigate to="dishes" replace />} />
          <Route path="dishes" element={<CatalogAdmin kind="dish" />} />
          <Route path="restaurants" element={<CatalogAdmin kind="restaurant" />} />
          <Route path="plans" element={<PlansAdmin />} />
          <Route path="notifications" element={<NotificationsAdmin />} />
          <Route path="settings" element={<BarkSettingsPage />} />
          <Route path="*" element={<Navigate to="dishes" replace />} />
        </Routes>
      </main>
    </div>
  );
}

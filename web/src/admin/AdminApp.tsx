import { Bell, CalendarDays, LayoutGrid, Settings, Store, Utensils } from 'lucide-react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { Logo, OfflineBanner } from '../components/AppShell';
import { AdminOverview } from './AdminOverview';
import { AdminWelcome } from './AdminWelcome';
import { BarkSettingsPage } from './BarkSettingsPage';
import { BulkImportPage } from './bulk/BulkImportPage';
import { CatalogAdmin } from './CatalogAdmin';
import { NotificationsAdmin } from './NotificationsAdmin';
import { PlansAdmin } from './PlansAdmin';

const TABS = [
  { to: 'overview', label: '概览', Icon: LayoutGrid },
  { to: 'dishes', label: '菜品', Icon: Utensils },
  { to: 'restaurants', label: '餐厅', Icon: Store },
  { to: 'plans', label: '计划', Icon: CalendarDays },
  { to: 'notifications', label: '通知', Icon: Bell },
  { to: 'settings', label: '推送设置', Icon: Settings },
];

/** Shell of the management pages. The brand leads back to the welcome page. */
function AdminLayout() {
  return (
    <div className="app admin">
      <a className="skip-link" href="#admin-main">
        跳到主要内容
      </a>
      <header className="topbar">
        <NavLink to="/admin" end className="brand" aria-label="回到后台欢迎页">
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
        <Outlet />
      </main>
    </div>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route index element={<AdminWelcome />} />
      <Route element={<AdminLayout />}>
        <Route path="overview" element={<AdminOverview />} />
        <Route path="dishes" element={<CatalogAdmin kind="dish" />} />
        <Route path="restaurants" element={<CatalogAdmin kind="restaurant" />} />
        <Route path="restaurants/import" element={<BulkImportPage />} />
        <Route path="plans" element={<PlansAdmin />} />
        <Route path="notifications" element={<NotificationsAdmin />} />
        <Route path="settings" element={<BarkSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

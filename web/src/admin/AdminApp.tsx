import { useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays, ChefHat, LogOut, Settings, Store, Utensils } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router';
import { api, ApiError } from '../api/client';
import { keys, useSession } from '../api/queries';
import { Logo, OfflineBanner } from '../components/AppShell';
import { Cloche } from '../components/Illustrations';
import { Loading } from '../components/Loading';
import { BarkSettingsPage } from './BarkSettingsPage';
import { CatalogAdmin } from './CatalogAdmin';
import { NotificationsAdmin } from './NotificationsAdmin';
import { PlansAdmin } from './PlansAdmin';

function AdminLogin() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/admin/login', { json: { password } });
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: keys.session });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <Logo />
        <Cloche className="gate-art gate-art-small" />
        <h1 className="gate-title">主厨后台</h1>
        <p className="gate-sub">只在内网可用。请输入管理密码。</p>
        <form onSubmit={submit} className="gate-form">
          <label htmlFor="admin-password" className="field-label">
            管理密码
          </label>
          <input
            id="admin-password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !password}>
            <ChefHat aria-hidden="true" />
            {busy ? '登录中…' : '进入后台'}
          </button>
          <p className="gate-msg gate-msg-error" role="alert">
            {error ?? ''}
          </p>
        </form>
      </div>
    </div>
  );
}

const TABS = [
  { to: 'dishes', label: '菜品', Icon: Utensils },
  { to: 'restaurants', label: '餐厅', Icon: Store },
  { to: 'plans', label: '计划', Icon: CalendarDays },
  { to: 'notifications', label: '通知', Icon: Bell },
  { to: 'settings', label: '推送设置', Icon: Settings },
];

export default function AdminApp() {
  const session = useSession();
  const queryClient = useQueryClient();
  if (session.isPending) return <Loading />;
  if (!session.data?.admin) return <AdminLogin />;

  const logout = async () => {
    try {
      await api('POST', '/admin/logout');
    } finally {
      await queryClient.invalidateQueries({ queryKey: keys.session });
    }
  };

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
          <button type="button" className="topnav-link" onClick={() => void logout()}>
            <LogOut aria-hidden="true" />
            <span>退出后台</span>
          </button>
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

import { useQueryClient } from '@tanstack/react-query';
import { CalendarHeart, History, LogOut, Settings2, WifiOff } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { api } from '../api/client';
import { useSession } from '../api/queries';
import { clearAllLocalData } from '../lib/drafts';
import { pantryStore } from '../lib/pantryStore';
import { useOnline } from '../lib/hooks';
import { useToast } from './Toast';

export function Logo() {
  return (
    <span className="logo">
      <svg viewBox="0 0 40 40" aria-hidden="true" className="logo-mark">
        <circle cx="20" cy="20" r="17" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="10" fill="var(--tomato)" />
        <path d="M16 11c2 2 6 2 8 0" stroke="var(--leaf)" strokeWidth="3" strokeLinecap="round" fill="none" />
      </svg>
      <span className="logo-text">Bistro Express</span>
    </span>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff aria-hidden="true" />
      <span>现在离线：可以继续编辑草稿（只存在本机），联网后再提交。</span>
    </div>
  );
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  return async () => {
    try {
      await api('POST', '/auth/logout');
    } catch {
      toast('网络异常，本机数据已清除，服务器会话将在到期后失效', 'error');
    }
    clearAllLocalData();
    // The remembered ingredients were wiped with the other local keys; drop the in-memory copy too.
    pantryStore().reset();
    queryClient.clear();
    navigate('/gate', { replace: true });
  };
}

export function AppShell() {
  const session = useSession();
  const logout = useLogout();
  const isInternal = session.data?.listener === 'admin';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Bistro Express 首页">
          <Logo />
        </NavLink>
        <nav className="topnav" aria-label="主导航">
          <NavLink to="/" end className="topnav-link">
            <CalendarHeart aria-hidden="true" />
            <span>计划</span>
          </NavLink>
          <NavLink to="/history" className="topnav-link">
            <History aria-hidden="true" />
            <span>历史</span>
          </NavLink>
          {isInternal && (
            <NavLink to="/admin" className="topnav-link">
              <Settings2 aria-hidden="true" />
              <span>后台</span>
            </NavLink>
          )}
          {!isInternal && (
            <button type="button" className="topnav-link" onClick={() => void logout()}>
              <LogOut aria-hidden="true" />
              <span>退出</span>
            </button>
          )}
        </nav>
      </header>
      <OfflineBanner />
      <main id="main" className="main">
        <Outlet />
      </main>
    </div>
  );
}

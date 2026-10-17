import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Logo } from '../components/AppShell';
import { Cloche } from '../components/Illustrations';

/** Front door of the back office: a quiet greeting and one way in. */
export function AdminWelcome() {
  return (
    <main className="admin-welcome">
      <div className="admin-welcome-card">
        <Logo />
        <Cloche className="admin-welcome-art" />
        <h1 className="admin-welcome-title">欢迎回来，主厨。</h1>
        <p className="admin-welcome-text">加菜、收藏店铺，看看最近的安排。</p>
        <Link to="/admin/overview" className="btn btn-primary admin-welcome-enter">
          进入
          <ArrowRight aria-hidden="true" />
        </Link>
        <Link to="/" className="admin-welcome-alt">
          去点餐
        </Link>
      </div>
    </main>
  );
}

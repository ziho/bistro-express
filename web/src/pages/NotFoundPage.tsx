import { Link } from 'react-router';
import { EmptyPlate } from '../components/Illustrations';

export function NotFoundPage() {
  return (
    <div className="center-page">
      <EmptyPlate className="empty-art" />
      <h1>这一页还没上菜</h1>
      <p className="muted">链接可能已失效，或者这道菜从没存在过。</p>
      <Link className="btn btn-primary" to="/">
        回到首页
      </Link>
    </div>
  );
}

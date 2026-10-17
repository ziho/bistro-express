import { Link } from 'react-router';
import { EmptyPlate } from '../components/Illustrations';

export function NotFoundPage() {
  return (
    <div className="center-page">
      <EmptyPlate className="empty-art" />
      <h1>找不到这一页</h1>
      <p className="muted">链接可能不对，或者内容已经删了。</p>
      <Link className="btn btn-primary" to="/">
        回到首页
      </Link>
    </div>
  );
}

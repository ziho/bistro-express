import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { UNAUTHORIZED_EVENT } from './api/client';
import { keys, useSession } from './api/queries';
import { AppShell } from './components/AppShell';
import { Loading } from './components/Loading';
import { EditorPage } from './pages/Editor/EditorPage';
import { GatePage } from './pages/GatePage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlanDetailPage } from './pages/PlanDetailPage';

const AdminApp = lazy(() => import('./admin/AdminApp'));

function RequireGuest({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  if (session.isPending) return <Loading />;
  if (!session.data?.guest) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/gate?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export function App() {
  const queryClient = useQueryClient();
  const session = useSession();

  useEffect(() => {
    const onUnauthorized = () => void queryClient.invalidateQueries({ queryKey: keys.session });
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  const isInternal = session.data?.listener === 'admin';

  return (
    <Routes>
      <Route path="/gate" element={<GatePage />} />
      {isInternal && (
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<Loading />}>
              <AdminApp />
            </Suspense>
          }
        />
      )}
      <Route
        element={
          <RequireGuest>
            <AppShell />
          </RequireGuest>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="plans/new" element={<EditorPage />} />
        <Route path="plans/:id" element={<PlanDetailPage />} />
        <Route path="plans/:id/edit" element={<EditorPage />} />
        <Route path="history" element={<HistoryPage />} />
      </Route>
      <Route path="*" element={session.isPending ? <Loading /> : <NotFoundPage />} />
    </Routes>
  );
}

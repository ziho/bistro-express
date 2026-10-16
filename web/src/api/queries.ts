import { useQuery } from '@tanstack/react-query';
import type { Catalog, Plan, SessionInfo } from '../../../shared/types';
import { api } from './client';

export const keys = {
  session: ['session'] as const,
  catalog: ['catalog'] as const,
  plans: (scope: string) => ['plans', scope] as const,
  plan: (id: string) => ['plan', id] as const,
};

export const useSession = () =>
  useQuery({ queryKey: keys.session, queryFn: () => api<SessionInfo>('GET', '/auth/session'), staleTime: 30_000 });

export const useCatalog = (enabled = true) =>
  useQuery({ queryKey: keys.catalog, queryFn: () => api<Catalog>('GET', '/catalog'), enabled });

export const usePlans = (range: { from?: string; to?: string }) => {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const qs = params.toString();
  return useQuery({
    queryKey: keys.plans(qs),
    queryFn: () => api<Plan[]>('GET', `/plans${qs ? `?${qs}` : ''}`),
  });
};

export const usePlan = (id: string | undefined) =>
  useQuery({
    queryKey: keys.plan(id ?? ''),
    queryFn: () => api<Plan>('GET', `/plans/${id}`),
    enabled: Boolean(id),
  });

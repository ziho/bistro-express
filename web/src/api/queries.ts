import { useQuery } from '@tanstack/react-query';
import { SHOPPING_REFRESH_MS } from '../../../shared/constants';
import type { Catalog, Plan, SessionInfo, ShoppingList } from '../../../shared/types';
import { api } from './client';
import type { VenueTagIndex } from '../../../shared/tagManagement';

export const keys = {
  session: ['session'] as const,
  catalog: ['catalog'] as const,
  venueTags: ['admin', 'venue-tags'] as const,
  plans: (scope: string) => ['plans', scope] as const,
  plan: (id: string) => ['plan', id] as const,
  shopping: (planId: string) => ['shopping', planId] as const,
};

export const useSession = () =>
  useQuery({ queryKey: keys.session, queryFn: () => api<SessionInfo>('GET', '/auth/session'), staleTime: 30_000 });

export const useCatalog = (enabled = true) =>
  useQuery({ queryKey: keys.catalog, queryFn: () => api<Catalog>('GET', '/catalog'), enabled, refetchInterval: 30_000, refetchIntervalInBackground: false });

export const useVenueTags = (enabled = true) =>
  useQuery({ queryKey: keys.venueTags, queryFn: () => api<VenueTagIndex>('GET', '/admin/restaurant-tags'), enabled, refetchInterval: 30_000, refetchIntervalInBackground: false });

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
    refetchInterval: (query) => {
      const status = query.state.data?.notification?.status;
      return status === 'pending' || status === 'sending' ? 2_000 : false;
    },
  });

/**
 * A saved meal's shared checklist. Shared across devices by pulling: refetched whenever the page
 * is opened or regains focus, and every SHOPPING_REFRESH_MS while it stays in the foreground.
 */
export const useShoppingList = (planId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.shopping(planId),
    queryFn: () => api<ShoppingList>('GET', `/plans/${planId}/shopping`),
    enabled,
    staleTime: 0,
    refetchInterval: SHOPPING_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

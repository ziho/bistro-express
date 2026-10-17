import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { ShoppingList } from '../../../../shared/types';
import { api, ApiError, newIdempotencyKey } from '../../api/client';
import { keys } from '../../api/queries';
import {
  classifyShoppingFailure,
  prepareShoppingRequest,
  shoppingFailureMessage,
  type PreparedShoppingRequest,
  type ShoppingFailureKind,
  type ShoppingIntent,
} from '../../lib/shopping';

export type ShoppingWriteResult =
  | { ok: true; list: ShoppingList }
  | { ok: false; kind: ShoppingFailureKind; message: string; field: string | null; current?: ShoppingList };

/**
 * Pessimistic shopping writes: nothing changes on screen until the server confirms, one write at
 * a time (all writes compare-and-set the same revision). Refusals (conflict, lock, missing item)
 * refresh the list from the answer; an unconfirmed failure keeps the prepared request so the
 * user's retry is the identical, idempotent request.
 */
export function useShoppingWriter(planId: string, list: ShoppingList | undefined) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const unconfirmed = useRef(new Map<string, PreparedShoppingRequest>());
  const inFlight = useRef(false);

  const run = useCallback(
    async (intent: ShoppingIntent, label: string, base?: Pick<ShoppingList, 'planVersion' | 'revision'>): Promise<ShoppingWriteResult> => {
      if (!list || inFlight.current) return { ok: false, kind: 'other', message: '请等上一个修改保存完', field: null };
      inFlight.current = true;
      setBusy(label);
      const prepared = prepareShoppingRequest(intent, base ?? list, unconfirmed.current, newIdempotencyKey);
      // A background refetch started before this write must not land after it with older data.
      await queryClient.cancelQueries({ queryKey: keys.shopping(planId) });
      try {
        const saved = await api<ShoppingList>(prepared.method, prepared.path, {
          jsonText: prepared.bodyText,
          idempotencyKey: prepared.idempotencyKey,
        });
        unconfirmed.current.delete(prepared.intentKey);
        queryClient.setQueryData(keys.shopping(planId), saved);
        // A replayed answer may be older than other writes since; make sure the view is current.
        void queryClient.invalidateQueries({ queryKey: keys.shopping(planId) });
        return { ok: true, list: saved };
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const code = err instanceof ApiError ? err.code : 'network';
        const kind = classifyShoppingFailure(status, code);
        if (kind === 'network') unconfirmed.current.set(prepared.intentKey, prepared);
        else unconfirmed.current.delete(prepared.intentKey);
        const details = err instanceof ApiError ? (err.details as { current?: ShoppingList; field?: string } | undefined) : undefined;
        if (details?.current) queryClient.setQueryData(keys.shopping(planId), details.current);
        else if (kind !== 'network' && kind !== 'invalid') await queryClient.invalidateQueries({ queryKey: keys.shopping(planId) });
        if (kind === 'locked' || (err instanceof ApiError && err.code === 'plan_changed')) {
          await queryClient.invalidateQueries({ queryKey: keys.plan(planId) });
        }
        const message = shoppingFailureMessage(kind, err instanceof ApiError ? err.message : '');
        return { ok: false, kind, message, field: details?.field ?? null, current: details?.current };
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [list, planId, queryClient],
  );

  return { run, busy };
}

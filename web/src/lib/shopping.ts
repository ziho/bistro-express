import type { ShoppingItem, ShoppingList } from '../../../shared/types';

/** Pending items first (shown open), then have/bought (shown in a collapsible "prepared" area). */
export function partitionShopping(items: readonly ShoppingItem[]): { pending: ShoppingItem[]; done: ShoppingItem[] } {
  return {
    pending: items.filter((i) => i.status === 'pending'),
    done: items.filter((i) => i.status !== 'pending'),
  };
}

/** One shopping write as the user meant it, before revisions are attached. */
export interface ShoppingIntent {
  method: 'PUT' | 'POST' | 'DELETE';
  path: string;
  payload: Record<string, unknown>;
}

/** The exact request sent for an intent; reused byte-for-byte when the same intent is retried. */
export interface PreparedShoppingRequest {
  intentKey: string;
  method: ShoppingIntent['method'];
  path: string;
  bodyText: string;
  idempotencyKey: string;
}

export const intentKeyOf = (intent: ShoppingIntent): string =>
  `${intent.method} ${intent.path} ${JSON.stringify(intent.payload)}`;

/**
 * Retrying the same intent after an unconfirmed failure resends the identical body with the same
 * Idempotency-Key, so a write whose response was lost is replayed rather than applied twice (no
 * duplicate manual item). Any other intent is prepared fresh against the current list.
 */
export function prepareShoppingRequest(
  intent: ShoppingIntent,
  list: Pick<ShoppingList, 'planVersion' | 'revision'>,
  unconfirmed: ReadonlyMap<string, PreparedShoppingRequest>,
  newKey: () => string,
): PreparedShoppingRequest {
  const intentKey = intentKeyOf(intent);
  const previous = unconfirmed.get(intentKey);
  if (previous) return previous;
  return {
    intentKey,
    method: intent.method,
    path: intent.path,
    bodyText: JSON.stringify({ ...intent.payload, expectedPlanVersion: list.planVersion, expectedRevision: list.revision }),
    idempotencyKey: newKey(),
  };
}

export type ShoppingFailureKind = 'network' | 'conflict' | 'locked' | 'missing' | 'invalid' | 'other';

/** network = outcome unknown (keep the prepared request for a safe retry); everything else was refused. */
export function classifyShoppingFailure(status: number, code: string): ShoppingFailureKind {
  if (status === 0 || status >= 500) return 'network';
  if (status === 409) return 'conflict';
  if (code === 'shopping_locked') return 'locked';
  if (status === 404) return 'missing';
  if (status === 400) return 'invalid';
  return 'other';
}

export function shoppingFailureMessage(kind: ShoppingFailureKind, serverMessage: string): string {
  switch (kind) {
    case 'network':
      return '网络不稳，没能确认是否保存。可以点「重试」，同一次修改不会被重复保存。';
    case 'conflict':
    case 'locked':
    case 'missing':
      return serverMessage;
    default:
      return serverMessage || '保存失败，请稍后再试';
  }
}

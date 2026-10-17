import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from '../shared/types.js';
import {
  classifyShoppingFailure,
  partitionShopping,
  prepareShoppingRequest,
  type PreparedShoppingRequest,
} from '../web/src/lib/shopping.js';

const item = (key: string, status: ShoppingItem['status']): ShoppingItem => ({ key, name: key, sources: [], status, needsReview: false });

describe('client shopping helpers', () => {
  it('shows pending items first and keeps have/bought together in list order', () => {
    const { pending, done } = partitionShopping([item('a', 'have'), item('b', 'pending'), item('c', 'bought'), item('d', 'pending')]);
    expect(pending.map((i) => i.key)).toEqual(['b', 'd']);
    expect(done.map((i) => i.key)).toEqual(['a', 'c']);
  });

  it('resends the identical body and key for a retried intent, even after the list moved on', () => {
    let n = 0;
    const newKey = () => `key-${(n += 1)}`;
    const intent = { method: 'POST' as const, path: '/plans/p/shopping/manual', payload: { name: '可乐', quantity: '', note: '' } };
    const first = prepareShoppingRequest(intent, { planVersion: 1, revision: 4 }, new Map(), newKey);
    expect(JSON.parse(first.bodyText)).toEqual({ name: '可乐', quantity: '', note: '', expectedPlanVersion: 1, expectedRevision: 4 });

    // The response was lost; a background refetch already shows revision 5 (our own write).
    const unconfirmed = new Map<string, PreparedShoppingRequest>([[first.intentKey, first]]);
    const retry = prepareShoppingRequest(intent, { planVersion: 1, revision: 5 }, unconfirmed, newKey);
    expect(retry).toBe(first);

    // A different intent (edited values) is a new request against the current revision.
    const edited = prepareShoppingRequest({ ...intent, payload: { ...intent.payload, quantity: '2瓶' } }, { planVersion: 1, revision: 5 }, unconfirmed, newKey);
    expect(edited.idempotencyKey).toBe('key-2');
    expect(JSON.parse(edited.bodyText).expectedRevision).toBe(5);
  });

  it('only treats unknown outcomes as retryable', () => {
    expect(classifyShoppingFailure(0, 'network')).toBe('network');
    expect(classifyShoppingFailure(502, 'http_error')).toBe('network');
    expect(classifyShoppingFailure(409, 'shopping_conflict')).toBe('conflict');
    expect(classifyShoppingFailure(409, 'plan_changed')).toBe('conflict');
    expect(classifyShoppingFailure(422, 'shopping_locked')).toBe('locked');
    expect(classifyShoppingFailure(404, 'manual_missing')).toBe('missing');
    expect(classifyShoppingFailure(400, 'invalid_request')).toBe('invalid');
    expect(classifyShoppingFailure(422, 'manual_limit')).toBe('other');
  });
});

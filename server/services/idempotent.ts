import type { DB } from '../db/connection.js';
import { sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import type { IdempotencyRepo, StoredResponse } from '../repos/misc.js';

export interface IdempotentRequest {
  key: string;
  /** method + path + body, hashed to detect key reuse for a different request. */
  fingerprintSource: string;
}

/**
 * Runs `fn` and stores its response under the idempotency key, all in one transaction. A retry
 * with the same key and identical request gets the stored response without running `fn` again;
 * the same key with a different request is rejected. A failing `fn` stores nothing.
 */
export function runIdempotent(
  deps: { db: DB; idempotency: IdempotencyRepo },
  req: IdempotentRequest,
  now: Date,
  fn: (now: Date) => StoredResponse,
): { replayed: boolean; response: StoredResponse } {
  const fingerprint = sha256(req.fingerprintSource);
  return deps.db.transaction(() => {
    const previous = deps.idempotency.lookup(req.key, fingerprint);
    if (previous === 'mismatch') {
      throw new HttpError(422, 'idempotency_mismatch', '重复的请求编号，请刷新后重试');
    }
    if (previous) return { replayed: true, response: previous };
    const response = fn(now);
    deps.idempotency.store(req.key, fingerprint, response, now);
    return { replayed: false, response };
  })();
}

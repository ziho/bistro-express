import { readStoredManualItems, readStoredShoppingStates, type ShoppingStateEntry } from '../../shared/shopping.js';
import type { ShoppingManualItem } from '../../shared/types.js';
import type { DB } from '../db/connection.js';

interface ShoppingRow {
  plan_id: string;
  revision: number;
  manual_json: string;
  states_json: string;
  created_at: string;
  updated_at: string;
}

/** The persisted part of one meal's checklist; groups themselves are always derived. */
export interface StoredShopping {
  planId: string;
  revision: number;
  manual: ShoppingManualItem[];
  states: ShoppingStateEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ShoppingWrite {
  manual: ShoppingManualItem[];
  states: ShoppingStateEntry[];
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const toStored = (r: ShoppingRow): StoredShopping => ({
  planId: r.plan_id,
  revision: r.revision,
  manual: readStoredManualItems(parseJson(r.manual_json)),
  states: readStoredShoppingStates(parseJson(r.states_json)),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createShoppingRepo(db: DB) {
  return {
    /** Read only; a plan that was never written has no row. */
    get(planId: string): StoredShopping | null {
      const row = db.prepare('SELECT * FROM plan_shopping WHERE plan_id = ?').get(planId) as ShoppingRow | undefined;
      return row ? toStored(row) : null;
    },

    /**
     * Writes the next revision. Returns false when the stored revision is no longer
     * `expectedRevision` (0 = no row yet), so concurrent writers can never overwrite each other.
     */
    save(planId: string, expectedRevision: number, w: ShoppingWrite, now: Date): boolean {
      const ts = now.toISOString();
      const manual = JSON.stringify(w.manual);
      const states = JSON.stringify(w.states);
      if (expectedRevision === 0) {
        const result = db
          .prepare(
            `INSERT INTO plan_shopping (plan_id, revision, manual_json, states_json, created_at, updated_at)
             VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(plan_id) DO NOTHING`,
          )
          .run(planId, manual, states, ts, ts);
        return result.changes === 1;
      }
      const result = db
        .prepare(
          `UPDATE plan_shopping SET revision = revision + 1, manual_json = ?, states_json = ?, updated_at = ?
           WHERE plan_id = ? AND revision = ?`,
        )
        .run(manual, states, ts, planId, expectedRevision);
      return result.changes === 1;
    },
  };
}

export type ShoppingRepo = ReturnType<typeof createShoppingRepo>;

import type { DishSnapshot, Plan, PlanMode, PlanStatus, RestaurantSnapshot } from '../../shared/types.js';
import { legacyLink, readStoredLinks, splitTags } from '../../shared/restaurant.js';
import type { DB } from '../db/connection.js';

interface PlanRow {
  id: string;
  short_id: string;
  status: PlanStatus;
  version: number;
  date: string;
  meal_label: string;
  local_time: string | null;
  time_zone: string;
  instant: string | null;
  mode: PlanMode;
  note: string;
  dishes_json: string;
  candidates_json: string;
  selected_json: string | null;
  source_plan_id: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

/** Plan fields without notification info (attached by the service layer). */
export type StoredPlan = Omit<Plan, 'notification'>;

export interface PlanWrite {
  date: string;
  mealLabel: string;
  localTime: string | null;
  timeZone: string;
  instant: string | null;
  mode: PlanMode;
  note: string;
  dishes: DishSnapshot[];
  candidates: RestaurantSnapshot[];
  selectedRestaurant: RestaurantSnapshot | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/**
 * Reads a stored restaurant snapshot of any age into the current shape without touching the
 * stored JSON. Snapshots saved before migration 3 have a `cuisine` and no tags/review/link:
 * their cuisine is shown as the tags, review and links stay empty. Snapshots saved before
 * migration 4 have no `links` array: their single linkUrl/linkLabel (if any) becomes one link.
 * An explicit `links` array — even an empty one — is used as is.
 */
function toRestaurantSnapshot(raw: unknown): RestaurantSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const tags = Array.isArray(s.tags)
    ? s.tags.filter((t): t is string => typeof t === 'string')
    : splitTags(str(s.cuisine));
  return {
    id: str(s.id),
    name: str(s.name),
    imageAssetId: strOrNull(s.imageAssetId),
    review: str(s.review),
    tags,
    budgetText: str(s.budgetText),
    address: str(s.address),
    mapUrl: strOrNull(s.mapUrl),
    links: Array.isArray(s.links) ? readStoredLinks(s.links) : legacyLink(s.linkUrl, s.linkLabel),
  };
}

function toRestaurantSnapshots(raw: unknown): RestaurantSnapshot[] {
  return Array.isArray(raw) ? raw.map(toRestaurantSnapshot).filter((s): s is RestaurantSnapshot => s !== null) : [];
}

const toPlan = (r: PlanRow): StoredPlan => ({
  id: r.id,
  shortId: r.short_id,
  status: r.status,
  version: r.version,
  date: r.date,
  mealLabel: r.meal_label,
  localTime: r.local_time,
  timeZone: r.time_zone,
  instant: r.instant,
  mode: r.mode,
  note: r.note,
  dishes: parseJson<DishSnapshot[]>(r.dishes_json, []),
  candidates: toRestaurantSnapshots(parseJson<unknown>(r.candidates_json, [])),
  selectedRestaurant: toRestaurantSnapshot(parseJson<unknown>(r.selected_json, null)),
  sourcePlanId: r.source_plan_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  cancelledAt: r.cancelled_at,
});

export function createPlanRepo(db: DB) {
  const insertRef = db.prepare('INSERT OR IGNORE INTO plan_refs (plan_id, kind, item_id) VALUES (?, ?, ?)');

  function writeRefs(planId: string, w: PlanWrite) {
    for (const d of w.dishes) insertRef.run(planId, 'dish', d.id);
    for (const r of w.candidates) insertRef.run(planId, 'restaurant', r.id);
  }

  return {
    get(id: string): StoredPlan | null {
      const row = db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
      return row ? toPlan(row) : null;
    },

    shortIdExists(shortId: string): boolean {
      return Boolean(db.prepare('SELECT 1 FROM plans WHERE short_id = ?').get(shortId));
    },

    list(opts: { from?: string; to?: string; limit: number }): StoredPlan[] {
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (opts.from) {
        clauses.push('date >= ?');
        params.push(opts.from);
      }
      if (opts.to) {
        clauses.push('date <= ?');
        params.push(opts.to);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db
        .prepare(`SELECT * FROM plans ${where} ORDER BY date ASC, COALESCE(instant, '') ASC, created_at ASC LIMIT ?`)
        .all(...params, opts.limit) as PlanRow[];
      return rows.map(toPlan);
    },

    insert(rec: { id: string; shortId: string; sourcePlanId: string | null } & PlanWrite, now: Date): void {
      const ts = now.toISOString();
      db.prepare(
        `INSERT INTO plans (id, short_id, status, version, date, meal_label, local_time, time_zone, instant, mode, note,
         dishes_json, candidates_json, selected_json, source_plan_id, created_at, updated_at)
         VALUES (?, ?, 'active', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        rec.id,
        rec.shortId,
        rec.date,
        rec.mealLabel,
        rec.localTime,
        rec.timeZone,
        rec.instant,
        rec.mode,
        rec.note,
        JSON.stringify(rec.dishes),
        JSON.stringify(rec.candidates),
        rec.selectedRestaurant ? JSON.stringify(rec.selectedRestaurant) : null,
        rec.sourcePlanId,
        ts,
        ts,
      );
      writeRefs(rec.id, rec);
    },

    /** Version-checked update. Returns false when the expected version no longer matches. */
    update(id: string, expectedVersion: number, w: PlanWrite, now: Date): boolean {
      const result = db
        .prepare(
          `UPDATE plans SET version = version + 1, date = ?, meal_label = ?, local_time = ?, time_zone = ?, instant = ?,
           mode = ?, note = ?, dishes_json = ?, candidates_json = ?, selected_json = ?, updated_at = ?
           WHERE id = ? AND version = ? AND status = 'active'`,
        )
        .run(
          w.date,
          w.mealLabel,
          w.localTime,
          w.timeZone,
          w.instant,
          w.mode,
          w.note,
          JSON.stringify(w.dishes),
          JSON.stringify(w.candidates),
          w.selectedRestaurant ? JSON.stringify(w.selectedRestaurant) : null,
          now.toISOString(),
          id,
          expectedVersion,
        );
      if (result.changes) writeRefs(id, w);
      return result.changes === 1;
    },

    cancel(id: string, expectedVersion: number, now: Date): boolean {
      const ts = now.toISOString();
      const result = db
        .prepare(
          `UPDATE plans SET status = 'cancelled', version = version + 1, cancelled_at = ?, updated_at = ?
           WHERE id = ? AND version = ? AND status = 'active'`,
        )
        .run(ts, ts, id, expectedVersion);
      return result.changes === 1;
    },
  };
}

export type PlanRepo = ReturnType<typeof createPlanRepo>;

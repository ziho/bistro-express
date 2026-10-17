import { LIMITS } from '../../shared/constants.js';
import { linkKeys, matchedLabels, storedLinkKeys } from '../../shared/mapsKeys.js';
import { classifyMapsUrl, parseMapsUrl } from '../../shared/mapsUrl.js';
import type { RestaurantDuplicate, RestaurantImportResponse, RestaurantImportResult } from '../../shared/types.js';
import type { DB } from '../db/connection.js';
import { sha256 } from '../lib/crypto.js';
import { conflict } from '../lib/errors.js';
import { restaurantInputSchema, type ImportRowInput, type RestaurantInput } from '../lib/validation.js';
import type { CatalogRepo } from '../repos/catalog.js';
import type { IdempotencyRepo } from '../repos/misc.js';
import type { IdempotentRequest } from './planService.js';

export interface RestaurantImportDeps {
  db: DB;
  catalog: CatalogRepo;
  idempotency: IdempotencyRepo;
  clock: () => Date;
}

type Prepared =
  | { ok: true; input: RestaurantInput; keys: Set<string> }
  | { ok: false; message: string; field: string | null };

/** A restaurant a new row may duplicate: saved before, or created earlier in this request. */
interface Anchor {
  id: string;
  name: string;
  active: boolean;
  keys: Set<string>;
}

/** Google Maps links are stored without tracking parameters; short links are kept as they are. */
function canonicalMapUrl(raw: string): { url: string } | { error: string } {
  const classified = classifyMapsUrl(raw);
  if (!classified.ok) return { error: classified.reason };
  const url = classified.kind === 'maps' ? parseMapsUrl(classified.url).cleanUrl : raw;
  if (url.length > LIMITS.url) return { error: `地图链接不能超过 ${LIMITS.url} 个字符` };
  return { url };
}

/** Validates one row offline. Nothing is fetched, and identifiers sent by the client are never trusted. */
function prepareRow(row: ImportRowInput): Prepared {
  const mapUrl = row.mapUrl.trim();
  if (!mapUrl) return { ok: false, message: '请填写地图链接', field: 'mapUrl' };
  const canonical = canonicalMapUrl(mapUrl);
  if ('error' in canonical) return { ok: false, message: canonical.error, field: 'mapUrl' };
  if (row.sourceUrl) {
    const source = classifyMapsUrl(row.sourceUrl);
    if (!source.ok) return { ok: false, message: `原始链接：${source.reason}`, field: 'sourceUrl' };
  }
  const parsed = restaurantInputSchema.safeParse({ name: row.name, tags: row.tags, mapUrl: canonical.url, active: true });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: issue?.message ?? '这一行无效', field: issue?.path.join('.') || null };
  }
  return { ok: true, input: parsed.data, keys: linkKeys([mapUrl, canonical.url, row.sourceUrl]) };
}

function duplicatesOf(keys: Set<string>, anchors: Anchor[]): RestaurantDuplicate[] {
  return anchors.flatMap((a) => {
    const matchedBy = matchedLabels(keys, a.keys);
    return matchedBy.length ? [{ id: a.id, name: a.name, active: a.active, matchedBy }] : [];
  });
}

function summarize(results: RestaurantImportResult[]): Omit<RestaurantImportResponse, 'replayed'> {
  const count = (status: RestaurantImportResult['status']) => results.filter((r) => r.status === status).length;
  return { results, created: count('created'), duplicates: count('duplicate'), errors: count('error') };
}

/**
 * Creates restaurants from bulk-import rows in one synchronous IMMEDIATE transaction, so a
 * concurrent import (or a retry racing its original) cannot slip a duplicate in between the
 * check and the insert. Every row is rechecked against the latest database — inactive restaurants
 * included — and against rows created earlier in the same request. No notifications are queued.
 */
export function createRestaurantImporter(deps: RestaurantImportDeps) {
  const { db, catalog, idempotency, clock } = deps;

  function importRows(rows: ImportRowInput[], now: Date): RestaurantImportResult[] {
    const anchors: Anchor[] = catalog
      .listRestaurants(false)
      .flatMap((r) => (r.mapUrl ? [{ id: r.id, name: r.name, active: r.active, keys: storedLinkKeys(r.mapUrl) }] : []));
    return rows.map((row): RestaurantImportResult => {
      const prepared = prepareRow(row);
      if (!prepared.ok) return { clientId: row.clientId, status: 'error', message: prepared.message, field: prepared.field };
      const duplicates = duplicatesOf(prepared.keys, anchors);
      if (duplicates.length) {
        return { clientId: row.clientId, status: 'duplicate', message: '已有相同地点的餐厅，已跳过', duplicates };
      }
      const created = catalog.createRestaurant(prepared.input, now);
      anchors.push({ id: created.id, name: created.name, active: created.active, keys: prepared.keys });
      return { clientId: row.clientId, status: 'created', restaurant: { id: created.id, name: created.name } };
    });
  }

  return {
    /** Replays the stored response for a repeated Idempotency-Key; a different payload is a 409. */
    run(rows: ImportRowInput[], req: IdempotentRequest): RestaurantImportResponse {
      const now = clock();
      const fingerprint = sha256(req.fingerprintSource);
      const transaction = db.transaction((): RestaurantImportResponse => {
        const previous = idempotency.lookup(req.key, fingerprint);
        if (previous === 'mismatch') {
          throw conflict('idempotency_mismatch', '这个导入请求编号已用于另一批内容，请重新提交');
        }
        if (previous) return { ...(previous.body as Omit<RestaurantImportResponse, 'replayed'>), replayed: true };
        const body = summarize(importRows(rows, now));
        idempotency.store(req.key, fingerprint, { status: 200, body }, now);
        return { ...body, replayed: false };
      });
      return transaction.immediate();
    },
  };
}

export type RestaurantImporter = ReturnType<typeof createRestaurantImporter>;

import { canonicalVenueTags, type VenueTagChange, type VenueTagIndex, type VenueTagPreview, type VenueTagResult } from '../../shared/tagManagement.js';
import { venueTagTypes } from '../../shared/venueTags.js';
import type { DB } from '../db/connection.js';
import { sha256 } from '../lib/crypto.js';
import { conflict, badRequest } from '../lib/errors.js';
import type { IdempotencyRepo } from '../repos/misc.js';
import type { CatalogRepo } from '../repos/catalog.js';
import { readVenueTagAliases } from '../repos/venueTags.js';
import { runIdempotent, type IdempotentRequest } from './idempotent.js';

export function createVenueTagService(deps: { db: DB; catalog: CatalogRepo; idempotency: IdempotencyRepo; clock: () => Date }) {
  const { db, catalog } = deps;
  function index(): VenueTagIndex {
    const counts = new Map<string, { count: number; activeCount: number }>();
    for (const shop of catalog.listRestaurants(false)) for (const tag of new Set(shop.tags)) {
      const c = counts.get(tag) ?? { count: 0, activeCount: 0 };
      c.count++; if (shop.active) c.activeCount++;
      counts.set(tag, c);
    }
    const aliases = readVenueTagAliases(db);
    return { aliases, tags: [...counts].map(([name, counts]) => ({ name, ...counts,
      oldNames: Object.entries(aliases).filter(([, target]) => target === name).map(([old]) => old),
    })).sort((a, b) => a.name.localeCompare(b.name, 'zh')) };
  }

  function preview(change: VenueTagChange): VenueTagPreview {
    const shops = catalog.listRestaurants(false);
    const sources = [...new Set(change.sources)].filter((tag) => tag !== change.target).sort();
    if (!sources.length) throw badRequest('请选择要修改的标签，并填写不同的新名称');
    const known = new Set(shops.flatMap((shop) => shop.tags));
    if (sources.some((tag) => !known.has(tag))) throw conflict('tags_changed', '标签已经有变化，请刷新列表后重新选择');
    const affected = shops.filter((shop) => shop.tags.some((tag) => sources.includes(tag)));
    const atTarget = shops.filter((shop) => shop.tags.includes(change.target));
    const combined = new Set([...affected, ...atTarget].map((shop) => shop.id));
    const fingerprint = sha256(JSON.stringify({ sources, target: change.target,
      shops: shops.filter((shop) => affected.includes(shop) || atTarget.includes(shop)).map((shop) => [shop.id, shop.name, shop.tags, shop.active]).sort(),
      aliases: readVenueTagAliases(db),
    }));
    return { sources, target: change.target, fingerprint, affected: affected.length,
      inactive: affected.filter((shop) => !shop.active).length, targetCount: atTarget.length,
      resultCount: combined.size, overlap: affected.filter((shop) => shop.tags.includes(change.target)).length,
      shops: affected.slice(0, 6).map(({ id, name, active }) => ({ id, name, active })), moreShops: Math.max(0, affected.length - 6),
    };
  }

  function apply(change: VenueTagChange & { expectedFingerprint: string }, req: IdempotentRequest): VenueTagResult {
    const { response } = runIdempotent(deps, req, deps.clock(), (now) => {
      const p = preview(change);
      if (p.fingerprint !== change.expectedFingerprint) throw conflict('tags_changed', '相关店铺有更新，请重新查看影响范围后再确认');
      const aliases: Record<string, string> = Object.assign(Object.create(null), readVenueTagAliases(db));
      // Reusing a former name (B -> A after A -> B) is allowed. Flat aliases prevent cycles.
      delete aliases[p.target];
      for (const [old, target] of Object.entries(aliases)) if (p.sources.includes(target)) aliases[old] = p.target;
      for (const source of p.sources) aliases[source] = p.target;
      const update = db.prepare('UPDATE restaurants SET tags = ?, treat_types_json = ?, updated_at = ? WHERE id = ?');
      for (const shop of catalog.listRestaurants(false)) {
        if (!shop.tags.some((tag) => p.sources.includes(tag))) continue;
        const tags = canonicalVenueTags(shop.tags, aliases);
        update.run(JSON.stringify(tags), JSON.stringify(venueTagTypes(tags)), now.toISOString(), shop.id);
      }
      db.prepare('DELETE FROM venue_tag_aliases').run();
      const save = db.prepare('INSERT INTO venue_tag_aliases(old_tag,target_tag,updated_at) VALUES(?,?,?)');
      for (const [old, target] of Object.entries(aliases)) if (old !== target) save.run(old, target, now.toISOString());
      return { status: 200, body: { affected: p.affected, target: p.target, merged: p.sources.length > 1 || p.targetCount > 0 } };
    });
    return response.body as VenueTagResult;
  }
  return { index, preview, apply };
}

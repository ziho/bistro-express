import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { migrateUnifiedVenueTags, runMigrations } from '../server/db/migrations.js';
import { parseRestaurantCreate, parseRestaurantUpdate } from '../server/lib/restaurantValidation.js';
import { mergeLegacyVenueTags } from '../shared/venueTags.js';
import { emptyVenueFilter, filterVenues, sameVenueFilter } from '../shared/venueFilter.js';
import { parseBulkDraft, serializeBulkDraft } from '../web/src/lib/bulkDraft.js';
import { newRow, setRowTreatTypes, buildPendingCommit, commitRows, analyzeQueue } from '../web/src/lib/bulkQueue.js';
import type { Restaurant } from '../shared/types.js';
import { loadVenueFilter, saveVenueFilter } from '../web/src/lib/venueFilterStore.js';

describe('one venue classification list', () => {
  it('keeps custom tags, recognizes existing aliases and appends missing legacy choices once', () => {
    expect(mergeLegacyVenueTags(['cafe', '巧克力', '约会'], ['coffee', 'cake', 'cake'])).toEqual(['cafe', '巧克力', '约会', '蛋糕']);
    expect(mergeLegacyVenueTags(['糖水／甜品', '面包／烘焙'], ['tong_sui', 'bakery'])).toEqual(['糖水／甜品', '面包／烘焙']);
  });

  it('migration 9 preserves every tag, entry, timestamp and historical snapshot, and can run twice', () => {
    const db = new Database(':memory:');
    try {
      runMigrations(db, 8);
      const tags = ['约会', ...Array.from({ length: 11 }, (_, n) => `特色${n}`)];
      db.prepare(`INSERT INTO restaurants(id,name,tags,purposes_json,treat_types_json,created_at,updated_at) VALUES('s','店',?,'["meal","treat"]','["coffee","cake"]','before','before')`).run(JSON.stringify(tags));
      db.prepare(`INSERT INTO plans(id,short_id,status,version,date,meal_label,time_zone,mode,candidates_json,selected_json,created_at,updated_at) VALUES('p','old','active',1,'2030-01-01','晚餐','Asia/Shanghai','restaurant','[{"tags":["旧分类"]}]','{"tags":["旧分类"]}','before','before')`).run();
      db.prepare(`INSERT INTO restaurants(id,name,tags,treat_types_json,created_at,updated_at) VALUES('bad','坏','invalid','["coffee"]','before','before')`).run();
      expect(runMigrations(db)).toEqual([9]);
      const read = () => db.prepare('SELECT * FROM restaurants WHERE id=?').get('s') as Record<string, string>;
      const first = read();
      expect(JSON.parse(first.tags!)).toEqual([...tags, '咖啡', '蛋糕']);
      expect(first).toMatchObject({ purposes_json: '["meal","treat"]', created_at: 'before', updated_at: 'before' });
      migrateUnifiedVenueTags(db);
      expect(read()).toEqual(first);
      expect(db.prepare('SELECT tags FROM restaurants WHERE id=?').get('bad')).toEqual({ tags: 'invalid' });
      expect(db.prepare('SELECT selected_json,candidates_json,updated_at FROM plans').get()).toEqual({ selected_json: '{"tags":["旧分类"]}', candidates_json: '[{"tags":["旧分类"]}]', updated_at: 'before' });
    } finally { db.close(); }
  });

  it('explicit tags can clear classification without resurrecting the old cached types; omitted tags stay', () => {
    const stored = { ...parseRestaurantCreate({ name: '店', tags: ['咖啡', '约会'], purposes: ['treat'] }), id: 's' } as Restaurant;
    expect(parseRestaurantUpdate({ name: '店', tags: [] }, stored)).toMatchObject({ tags: [], treatTypes: [], purposes: ['treat'] });
    expect(parseRestaurantUpdate({ name: '店' }, stored).tags).toEqual(['咖啡', '约会']);
    expect(parseRestaurantCreate({ name: '店', tags: ['咖啡'], treatTypes: ['coffee', 'cake'] })).toMatchObject({ tags: ['咖啡', '蛋糕'], treatTypes: ['coffee', 'cake'] });
    expect(() => parseRestaurantCreate({ name: '店', tags: Array.from({ length: 25 }, (_, n) => `分类${n}`) })).toThrow();
    expect(parseRestaurantCreate({ name: '店', tags: Array.from({ length: 19 }, (_, n) => `分类${n}`) }).tags).toHaveLength(19);
  });

  it('entry, region and tag criteria combine; unclassified means no tags', () => {
    const a = { ...parseRestaurantCreate({ name: 'Revolver', tags: ['咖啡', '约会'], purposes: ['treat'] }), id: 'a' } as Restaurant;
    const b = { ...a, id: 'b', tags: [] };
    const c = { ...a, id: 'c', purposes: ['meal'] } as Restaurant;
    expect(filterVenues([a, b, c], { ...emptyVenueFilter('treat'), tags: ['咖啡', '约会'], tagMode: 'all' }).map((v) => v.id)).toEqual(['a']);
    expect(filterVenues([a, b, c], { ...emptyVenueFilter('treat'), untagged: true }).map((v) => v.id)).toEqual(['b']);
    expect(sameVenueFilter(emptyVenueFilter(), { ...emptyVenueFilter(), untagged: true })).toBe(false);
  });

  it('upgrades old queued types without changing an unanswered request body or re-adding deleted tags', () => {
    const row = setRowTreatTypes(newRow('https://maps.app.goo.gl/abc123', 'row1'), ['coffee', 'cake']);
    const pending = buildPendingCommit([{ clientId: 'row1', name: '店', mapUrl: row.sourceUrl, sourceUrl: null, tags: [], treatTypes: ['coffee'], purposes: ['treat'] }], 'same-key-123');
    const raw = JSON.stringify({ version: 3, rows: [row], pendingCommit: pending });
    const restored = parseBulkDraft(raw)!;
    expect(restored.rows[0]).toMatchObject({ tags: '咖啡 蛋糕', treatTypes: [] });
    expect(restored.pendingCommit).toEqual(pending);
    const edited = { ...restored, rows: [{ ...restored.rows[0]!, tags: '' }] };
    expect(parseBulkDraft(serializeBulkDraft(edited))?.rows[0]!.tags).toBe('');
    const importable = { ...row, name: '店', mapUrl: 'https://www.google.com/maps?q=Shop', selected: true, status: 'resolved' as const };
    const info = analyzeQueue({ rows: [importable], pendingCommit: null }, []);
    const body = commitRows({ rows: [importable], pendingCommit: null }, info);
    expect(body[0]).toMatchObject({ tags: ['咖啡', '蛋糕'] });
    expect(body[0]).not.toHaveProperty('treatTypes');
  });

  it('turns remembered legacy type filters into visible tags and saves no hidden type criterion', () => {
    let saved = JSON.stringify({ version: 1, treat: { tags: [], tagMode: 'any', places: [], treatTypes: ['coffee', 'cake'] } });
    vi.stubGlobal('window', { localStorage: { getItem: () => saved, setItem: (_: string, value: string) => { saved = value; } } });
    try {
      const f = loadVenueFilter('treat', { tags: new Set(['咖啡', '蛋糕', '约会']), places: new Set() });
      expect(f.tags).toEqual(['咖啡', '蛋糕']);
      expect(f.treatTypes).toEqual([]);
      saveVenueFilter('treat', f);
      expect(JSON.parse(saved).treat).toMatchObject({ tags: ['咖啡', '蛋糕'], treatTypes: [] });
    } finally { vi.unstubAllGlobals(); }
  });
});

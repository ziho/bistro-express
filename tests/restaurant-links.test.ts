import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../shared/constants.js';
import { migrateRestaurantLinks, runMigrations } from '../server/db/migrations.js';
import { createTestEnv, idem, seedRestaurant, type Client, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(() => env.cleanup());

const TS = '2030-01-01T00:00:00Z';
const ID = {
  labelled: '00000000-0000-4000-8000-000000000011',
  unlabelled: '00000000-0000-4000-8000-000000000012',
  none: '00000000-0000-4000-8000-000000000013',
  blank: '00000000-0000-4000-8000-000000000014',
};
const PLAN = {
  legacyLink: '33333333-3333-4333-8333-333333333331',
  legacyNoLink: '33333333-3333-4333-8333-333333333332',
  explicitEmpty: '33333333-3333-4333-8333-333333333333',
};
const MENU = 'https://example.com/menu';
const SITE = 'https://example.com/';

/** A schema-v3 snapshot: single linkUrl/linkLabel, no links array. */
const v3Snapshot = (linkUrl: string | null, linkLabel: string) => ({
  id: ID.labelled,
  name: '小酒馆',
  imageAssetId: null,
  review: '适合约会',
  tags: ['西餐'],
  budgetText: '',
  address: '',
  mapUrl: null,
  linkUrl,
  linkLabel,
});

/** A database as written by the previous release (schema v3, one optional link per restaurant). */
function seedV3(dataDir: string) {
  const db = new Database(path.join(dataDir, 'bistro.sqlite'));
  runMigrations(db, 3);
  const insert = db.prepare(
    `INSERT INTO restaurants (id, name, review, tags, link_url, link_label, active, created_at, updated_at)
     VALUES (?, ?, '', '[]', ?, ?, 1, ?, ?)`,
  );
  insert.run(ID.labelled, '小酒馆', MENU, '看菜单', TS, TS);
  insert.run(ID.unlabelled, '面馆', SITE, '', TS, TS);
  insert.run(ID.none, '小吃摊', null, '没网址的旧文字', TS, TS);
  insert.run(ID.blank, '空白', '   ', '', TS, TS);

  const plan = db.prepare(
    `INSERT INTO plans (id, short_id, status, version, date, meal_label, time_zone, mode, candidates_json, selected_json,
     created_at, updated_at) VALUES (?, ?, 'active', 1, '2030-01-20', '晚餐', 'Asia/Shanghai', 'restaurant', ?, ?, ?, ?)`,
  );
  const withLink = v3Snapshot(MENU, '看菜单');
  plan.run(PLAN.legacyLink, 'OLD301', JSON.stringify([withLink]), JSON.stringify(withLink), TS, TS);
  const noLink = v3Snapshot(null, '');
  plan.run(PLAN.legacyNoLink, 'OLD302', JSON.stringify([noLink]), JSON.stringify(noLink), TS, TS);
  // Written by the new release (links: []) but still carrying stale legacy keys: must never resurrect.
  const explicit = { ...v3Snapshot(MENU, '看菜单'), links: [] };
  plan.run(PLAN.explicitEmpty, 'NEW303', JSON.stringify([explicit]), JSON.stringify(explicit), TS, TS);
  db.close();
}

const rawLinks = (e: TestEnv) =>
  e.ctx.db.prepare('SELECT id, links_json, link_url, link_label, updated_at FROM restaurants ORDER BY id').all() as {
    id: string;
    links_json: string;
    link_url: string | null;
    link_label: string;
    updated_at: string;
  }[];

describe('migration 4: restaurant links', () => {
  it('moves each legacy link into the links array and keeps the old columns', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV3 });
    const versions = env.ctx.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    expect(versions).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);

    const admin = await env.admin();
    const list = (await admin.get('/bistro/api/admin/restaurants')).body.data as Record<string, unknown>[];
    const byId = new Map(list.map((r) => [r.id, r]));
    expect(byId.get(ID.labelled)!.links).toEqual([{ label: '看菜单', url: MENU }]);
    expect(byId.get(ID.unlabelled)!.links).toEqual([{ label: '', url: SITE }]);
    expect(byId.get(ID.none)!.links).toEqual([]);
    expect(byId.get(ID.blank)!.links).toEqual([]);
    for (const r of list) {
      expect(r).not.toHaveProperty('linkUrl');
      expect(r).not.toHaveProperty('linkLabel');
    }

    const raw = new Map(rawLinks(env).map((r) => [r.id, r]));
    expect(raw.get(ID.labelled)).toMatchObject({ link_url: MENU, link_label: '看菜单' }); // kept, no longer read
    for (const r of raw.values()) expect(r.updated_at).toBe(TS);

    await env.ctx.worker.drain();
    expect(env.provider.sent).toHaveLength(0);
    expect((env.ctx.db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n).toBe(0);
  });

  it('is idempotent when the data step or the migrator runs again', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV3 });
    const before = rawLinks(env);
    env.ctx.db.transaction(() => migrateRestaurantLinks(env.ctx.db))();
    env.ctx.db.transaction(() => migrateRestaurantLinks(env.ctx.db))();
    expect(runMigrations(env.ctx.db)).toEqual([]);
    expect(rawLinks(env)).toEqual(before);
  });

  it('never resurrects a cleared legacy link, and keeps edited links on a re-run', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV3 });
    const admin = await env.admin();
    const cleared = await admin.put(`/bistro/api/admin/restaurants/${ID.labelled}`, { name: '小酒馆', links: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.links).toEqual([]);
    const edited = await admin.put(`/bistro/api/admin/restaurants/${ID.unlabelled}`, {
      name: '面馆',
      links: [{ label: '订位', url: 'https://book.example.com/' }],
    });
    expect(edited.status).toBe(200);

    env.ctx.db.transaction(() => migrateRestaurantLinks(env.ctx.db))();
    const list = (await admin.get('/bistro/api/admin/restaurants')).body.data as { id: string; links: unknown }[];
    const byId = new Map(list.map((r) => [r.id, r.links]));
    expect(byId.get(ID.labelled)).toEqual([]);
    expect(byId.get(ID.unlabelled)).toEqual([{ label: '订位', url: 'https://book.example.com/' }]);
    const raw = new Map(rawLinks(env).map((r) => [r.id, r]));
    expect(raw.get(ID.labelled)).toMatchObject({ link_url: null, link_label: '' });
  });

  it('reads old plan snapshots: legacy link as one entry, explicit [] as no links, stored JSON untouched', async () => {
    env = await createTestEnv(undefined, { beforeOpen: seedV3 });
    const guest = await env.guest();
    const get = async (id: string) => (await guest.get(`/bistro/api/plans/${id}`)).body.data;

    const legacy = await get(PLAN.legacyLink);
    expect(legacy.selectedRestaurant.links).toEqual([{ label: '看菜单', url: MENU }]);
    expect(legacy.candidates[0].links).toEqual([{ label: '看菜单', url: MENU }]);
    expect(legacy.selectedRestaurant).not.toHaveProperty('linkUrl');
    expect((await get(PLAN.legacyNoLink)).selectedRestaurant.links).toEqual([]);
    const explicit = await get(PLAN.explicitEmpty);
    expect(explicit.selectedRestaurant.links).toEqual([]);
    expect(explicit.candidates[0].links).toEqual([]);

    const row = env.ctx.db.prepare('SELECT selected_json, version FROM plans WHERE id = ?').get(PLAN.legacyLink) as {
      selected_json: string;
      version: number;
    };
    expect(JSON.parse(row.selected_json)).toEqual(v3Snapshot(MENU, '看菜单'));
    expect(row.version).toBe(1);
  });
});

const restaurantPlan = (candidateIds: string[], selectedRestaurantId: string) => ({
  date: '2030-01-20',
  mealLabel: '晚餐',
  localTime: null,
  timeZone: 'Asia/Shanghai',
  mode: 'restaurant',
  note: '',
  dishIds: [],
  candidateIds,
  selectedRestaurantId,
});

const create = (admin: Client, body: Record<string, unknown>) => admin.post('/bistro/api/admin/restaurants', body);
const link = (label: string, url: string) => ({ label, url });
const nLinks = (n: number) => Array.from({ length: n }, (_, i) => link(`链接${i + 1}`, `https://example.com/${i + 1}`));

describe('restaurant links API', () => {
  it('creates, reads, edits, reorders and clears several named links', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const guest = await env.guest();
    const created = await create(admin, {
      name: '小酒馆',
      links: [
        link(' 看菜单 ', ` ${MENU} `),
        link('', ''), // unused editor row: omitted
        link('', SITE), // no name: shown with the default label
        link('订  位', 'https://book.example.com/?a=1&b=2#x'),
      ],
    });
    expect(created.status).toBe(201);
    const r = created.body.data;
    const expected = [link('看菜单', MENU), link('', SITE), link('订 位', 'https://book.example.com/?a=1&b=2#x')];
    expect(r.links).toEqual(expected);
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurants[0].links).toEqual(expected);

    const reordered = [link('访问官网', SITE), link('看菜单', MENU)];
    const edited = await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { ...r, links: reordered });
    expect(edited.status).toBe(200);
    expect(edited.body.data.links).toEqual(reordered);

    // Toggling active keeps the links.
    await admin.patch(`/bistro/api/admin/restaurants/${r.id}/active`, { active: false });
    await admin.patch(`/bistro/api/admin/restaurants/${r.id}/active`, { active: true });
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurants[0].links).toEqual(reordered);

    const cleared = await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { ...r, links: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.links).toEqual([]);
    expect((await guest.get('/bistro/api/catalog')).body.data.restaurants[0].links).toEqual([]);
  });

  it(`accepts up to ${LIMITS.restaurantLinks} links and rejects more`, async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const ok = await create(admin, { name: 'a', links: nLinks(LIMITS.restaurantLinks) });
    expect(ok.status).toBe(201);
    expect(ok.body.data.links).toHaveLength(LIMITS.restaurantLinks);
    const tooMany = await create(admin, { name: 'b', links: nLinks(LIMITS.restaurantLinks + 1) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.details.field).toBe('links');
    const update = await admin.put(`/bistro/api/admin/restaurants/${ok.body.data.id}`, { name: 'a', links: nLinks(LIMITS.restaurantLinks + 1) });
    expect(update.status).toBe(400);
  });

  it('enforces the name length and requires a URL for a named row', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const longest = '字'.repeat(LIMITS.linkLabel);
    expect((await create(admin, { name: 'a', links: [link(longest, MENU)] })).body.data.links).toEqual([link(longest, MENU)]);
    const tooLong = await create(admin, { name: 'b', links: [link(longest + '字', MENU)] });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.details.field).toBe('links.0.label');
    const noUrl = await create(admin, { name: 'c', links: [link('看菜单', MENU), link('官网', '  ')] });
    expect(noUrl.status).toBe(400);
    expect(noUrl.body.error.details.field).toBe('links.1.url');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>hi</b>',
    'ftp://example.com/menu',
    'example.com/menu',
    '//example.com/menu',
    'https://user:pass@example.com/',
    'https://exa mple.com/',
    'https://example.com/a b',
    `https://example.com/${'x'.repeat(LIMITS.url)}`,
  ])('rejects the unsafe link URL %s', async (url) => {
    env = await createTestEnv();
    const admin = await env.admin();
    const res = await create(admin, { name: 'x', links: [link('好链接', MENU), link('坏链接', url)] });
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('links.1.url');
    const ok = await seedRestaurant(admin, 'y');
    const update = await admin.put(`/bistro/api/admin/restaurants/${ok.id}`, { name: 'y', links: [link('坏链接', url)] });
    expect(update.status).toBe(400);
  });

  it('rejects malformed link entries', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    for (const links of ['https://example.com', [MENU], [{ label: 1, url: MENU }], [{ label: 'a', url: 5 }]]) {
      expect((await create(admin, { name: 'x', links })).status).toBe(400);
    }
  });
});

describe('legacy single-link input (older cached clients)', () => {
  it('translates linkUrl/linkLabel into one link when links is absent', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const res = await create(admin, { name: 'a', linkUrl: ` ${MENU} `, linkLabel: '看菜单' });
    expect(res.status).toBe(201);
    expect(res.body.data.links).toEqual([link('看菜单', MENU)]);
    expect(res.body.data).not.toHaveProperty('linkUrl');
    expect((await create(admin, { name: 'b', linkUrl: SITE })).body.data.links).toEqual([link('', SITE)]);
    // The old form sent the label even after the URL was cleared: no link, no error.
    for (const linkUrl of [null, '']) {
      const empty = await create(admin, { name: 'c', linkUrl, linkLabel: '看菜单' });
      expect(empty.status).toBe(201);
      expect(empty.body.data.links).toEqual([]);
    }
  });

  it('lets an explicit links array win, including [] which clears', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const r = (await create(admin, { name: 'a', links: [link('看菜单', MENU)] })).body.data;
    const both = await admin.put(`/bistro/api/admin/restaurants/${r.id}`, {
      name: 'a',
      links: [link('访问官网', SITE)],
      linkUrl: 'https://ignored.example.com/',
      linkLabel: '忽略',
    });
    expect(both.body.data.links).toEqual([link('访问官网', SITE)]);
    const cleared = await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { name: 'a', links: [], linkUrl: MENU });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.links).toEqual([]);
  });

  it('validates a legacy URL like any other link', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const bad = await create(admin, { name: 'a', linkUrl: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.field).toBe('links.0.url');
    const longLabel = await create(admin, { name: 'b', linkUrl: MENU, linkLabel: '字'.repeat(LIMITS.linkLabel + 1) });
    expect(longLabel.status).toBe(400);
  });
});

describe('links in plan snapshots', () => {
  it('freezes all links when the plan is saved', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const guest = await env.guest();
    const original = [link('看菜单', MENU), link('', SITE), link('<b>订位</b>', 'https://book.example.com/')];
    const r = await seedRestaurant(admin, '小酒馆', { links: original });
    const created = await guest.post('/bistro/api/plans', restaurantPlan([r.id], r.id), idem());
    expect(created.status).toBe(201);
    expect(created.body.data.selectedRestaurant.links).toEqual(original); // verbatim; React escapes the label
    expect(created.body.data.candidates[0].links).toEqual(original);

    await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { name: '小酒馆', links: [link('新菜单', 'https://new.example.com/')] });
    const again = (await guest.get(`/bistro/api/plans/${created.body.data.id}`)).body.data;
    expect(again.selectedRestaurant.links).toEqual(original);

    await admin.put(`/bistro/api/admin/restaurants/${r.id}`, { name: '小酒馆', links: [] });
    const next = await guest.post('/bistro/api/plans', restaurantPlan([r.id], r.id), idem());
    expect(next.body.data.selectedRestaurant.links).toEqual([]);
    expect((await guest.get(`/bistro/api/plans/${created.body.data.id}`)).body.data.selectedRestaurant.links).toEqual(original);
  });
});

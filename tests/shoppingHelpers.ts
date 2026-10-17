import type { Client, TestEnv } from './helpers.js';
import { homePlan, idem, seedDish } from './helpers.js';

export const ing = (name: string, quantity = '', purchaseNote = '') => ({ name, quantity, purchaseNote });

export const shoppingPath = (planId: string, rest = '') => `/bistro/api/plans/${planId}/shopping${rest}`;

/** The three dishes most shopping tests use: two share 鸡蛋 with the same free-text quantity. */
export async function seedKitchen(admin: Client) {
  const tomatoEgg = await seedDish(admin, '番茄炒蛋', {
    ingredients: [ing('番茄', '2颗', '要熟一点'), ing('鸡蛋', '2颗')],
    shoppingNote: '番茄挑软一点',
  });
  const eggSoup = await seedDish(admin, '鸡蛋汤', { ingredients: [ing('鸡蛋', '2颗', '土鸡蛋'), ing('小葱', '一把')] });
  const congee = await seedDish(admin, '白粥', {});
  return { tomatoEgg, eggSoup, congee };
}

export async function createHomePlan(guest: Client, dishIds: string[], extra: Record<string, unknown> = {}) {
  const res = await guest.post('/bistro/api/plans', homePlan(dishIds, extra), idem());
  if (res.status !== 201) throw new Error(`create plan failed: ${res.text}`);
  return res.body.data as { id: string; version: number; updatedAt: string };
}

export async function getList(client: Client, planId: string) {
  const res = await client.get(shoppingPath(planId));
  if (res.status !== 200) throw new Error(`get shopping failed: ${res.text}`);
  return res.body.data;
}

type Expected = { planVersion: number; revision: number };
const expectedOf = (list: Expected) => ({ expectedPlanVersion: list.planVersion, expectedRevision: list.revision });

export const setStatus = (client: Client, planId: string, list: Expected, key: string, status: string, opts = idem()) =>
  client.put(shoppingPath(planId, '/status'), { key, status, ...expectedOf(list) }, opts);

export const addManual = (client: Client, planId: string, list: Expected, item: Record<string, unknown>, opts = idem()) =>
  client.post(shoppingPath(planId, '/manual'), { ...item, ...expectedOf(list) }, opts);

export const updateManual = (client: Client, planId: string, list: Expected, id: string, item: Record<string, unknown>) =>
  client.put(shoppingPath(planId, `/manual/${id}`), { ...item, ...expectedOf(list) }, idem());

export const deleteManual = (client: Client, planId: string, list: Expected, id: string) =>
  client.request('DELETE', shoppingPath(planId, `/manual/${id}`), { json: expectedOf(list), ...idem() });

export const itemOf = (list: { items: { key: string }[] }, key: string) =>
  list.items.find((i) => i.key === key) as { key: string; status: string; needsReview: boolean; sources: Record<string, unknown>[] } | undefined;

export const rawPlanRow = (env: TestEnv, id: string) =>
  env.ctx.db.prepare('SELECT version, updated_at, dishes_json FROM plans WHERE id = ?').get(id) as {
    version: number;
    updated_at: string;
    dishes_json: string;
  };

export const countRows = (env: TestEnv, table: string) =>
  (env.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

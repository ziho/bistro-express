import { randomUUID } from 'node:crypto';
import type { Dish, Restaurant } from '../../shared/types.js';
import type { DB } from '../db/connection.js';
import type { DishInput, RestaurantInput } from '../lib/validation.js';

interface DishRow {
  id: string;
  name: string;
  image_asset_id: string | null;
  category: string;
  tags: string;
  description: string;
  recipe_url: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface RestaurantRow {
  id: string;
  name: string;
  image_asset_id: string | null;
  cuisine: string;
  tags: string;
  budget_text: string;
  address: string;
  map_url: string | null;
  note: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

const toDish = (r: DishRow): Dish => ({
  id: r.id,
  name: r.name,
  imageAssetId: r.image_asset_id,
  category: r.category,
  tags: parseTags(r.tags),
  description: r.description,
  recipeUrl: r.recipe_url,
  active: r.active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toRestaurant = (r: RestaurantRow): Restaurant => ({
  id: r.id,
  name: r.name,
  imageAssetId: r.image_asset_id,
  cuisine: r.cuisine,
  tags: parseTags(r.tags),
  budgetText: r.budget_text,
  address: r.address,
  mapUrl: r.map_url,
  note: r.note,
  active: r.active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createCatalogRepo(db: DB) {
  const isReferenced = db.prepare('SELECT 1 FROM plan_refs WHERE kind = ? AND item_id = ? LIMIT 1');

  return {
    listDishes(onlyActive: boolean): Dish[] {
      const sql = onlyActive
        ? 'SELECT * FROM dishes WHERE active = 1 ORDER BY name COLLATE NOCASE'
        : 'SELECT * FROM dishes ORDER BY active DESC, updated_at DESC';
      return (db.prepare(sql).all() as DishRow[]).map(toDish);
    },

    getDish(id: string): Dish | null {
      const row = db.prepare('SELECT * FROM dishes WHERE id = ?').get(id) as DishRow | undefined;
      return row ? toDish(row) : null;
    },

    getDishes(ids: string[]): Dish[] {
      if (ids.length === 0) return [];
      const rows = db
        .prepare(`SELECT * FROM dishes WHERE id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids) as DishRow[];
      return rows.map(toDish);
    },

    createDish(input: DishInput, now: Date): Dish {
      const id = randomUUID();
      const ts = now.toISOString();
      db.prepare(
        `INSERT INTO dishes (id, name, image_asset_id, category, tags, description, recipe_url, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.name,
        input.imageAssetId,
        input.category,
        JSON.stringify(input.tags),
        input.description,
        input.recipeUrl,
        input.active ? 1 : 0,
        ts,
        ts,
      );
      return this.getDish(id)!;
    },

    updateDish(id: string, input: DishInput, now: Date): Dish | null {
      const result = db
        .prepare(
          `UPDATE dishes SET name = ?, image_asset_id = ?, category = ?, tags = ?, description = ?, recipe_url = ?,
           active = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.imageAssetId,
          input.category,
          JSON.stringify(input.tags),
          input.description,
          input.recipeUrl,
          input.active ? 1 : 0,
          now.toISOString(),
          id,
        );
      return result.changes ? this.getDish(id) : null;
    },

    setDishActive(id: string, active: boolean, now: Date): Dish | null {
      const result = db
        .prepare('UPDATE dishes SET active = ?, updated_at = ? WHERE id = ?')
        .run(active ? 1 : 0, now.toISOString(), id);
      return result.changes ? this.getDish(id) : null;
    },

    /** Hard delete only when no plan ever referenced the dish. Returns 'referenced' otherwise. */
    deleteDish(id: string): 'deleted' | 'referenced' | 'missing' {
      if (isReferenced.get('dish', id)) return 'referenced';
      return db.prepare('DELETE FROM dishes WHERE id = ?').run(id).changes ? 'deleted' : 'missing';
    },

    listRestaurants(onlyActive: boolean): Restaurant[] {
      const sql = onlyActive
        ? 'SELECT * FROM restaurants WHERE active = 1 ORDER BY name COLLATE NOCASE'
        : 'SELECT * FROM restaurants ORDER BY active DESC, updated_at DESC';
      return (db.prepare(sql).all() as RestaurantRow[]).map(toRestaurant);
    },

    getRestaurant(id: string): Restaurant | null {
      const row = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(id) as RestaurantRow | undefined;
      return row ? toRestaurant(row) : null;
    },

    getRestaurants(ids: string[]): Restaurant[] {
      if (ids.length === 0) return [];
      const rows = db
        .prepare(`SELECT * FROM restaurants WHERE id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids) as RestaurantRow[];
      return rows.map(toRestaurant);
    },

    createRestaurant(input: RestaurantInput, now: Date): Restaurant {
      const id = randomUUID();
      const ts = now.toISOString();
      db.prepare(
        `INSERT INTO restaurants (id, name, image_asset_id, cuisine, tags, budget_text, address, map_url, note, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.name,
        input.imageAssetId,
        input.cuisine,
        JSON.stringify(input.tags),
        input.budgetText,
        input.address,
        input.mapUrl,
        input.note,
        input.active ? 1 : 0,
        ts,
        ts,
      );
      return this.getRestaurant(id)!;
    },

    updateRestaurant(id: string, input: RestaurantInput, now: Date): Restaurant | null {
      const result = db
        .prepare(
          `UPDATE restaurants SET name = ?, image_asset_id = ?, cuisine = ?, tags = ?, budget_text = ?, address = ?,
           map_url = ?, note = ?, active = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          input.name,
          input.imageAssetId,
          input.cuisine,
          JSON.stringify(input.tags),
          input.budgetText,
          input.address,
          input.mapUrl,
          input.note,
          input.active ? 1 : 0,
          now.toISOString(),
          id,
        );
      return result.changes ? this.getRestaurant(id) : null;
    },

    setRestaurantActive(id: string, active: boolean, now: Date): Restaurant | null {
      const result = db
        .prepare('UPDATE restaurants SET active = ?, updated_at = ? WHERE id = ?')
        .run(active ? 1 : 0, now.toISOString(), id);
      return result.changes ? this.getRestaurant(id) : null;
    },

    deleteRestaurant(id: string): 'deleted' | 'referenced' | 'missing' {
      if (isReferenced.get('restaurant', id)) return 'referenced';
      return db.prepare('DELETE FROM restaurants WHERE id = ?').run(id).changes ? 'deleted' : 'missing';
    },
  };
}

export type CatalogRepo = ReturnType<typeof createCatalogRepo>;

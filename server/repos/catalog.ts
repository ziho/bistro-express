import { randomUUID } from 'node:crypto';
import { readMinutes, readStoredIngredients, readStoredSections } from '../../shared/dish.js';
import { readStoredLinks } from '../../shared/restaurant.js';
import { venueTagTypes } from '../../shared/venueTags.js';
import { canonicalVenueTags } from '../../shared/tagManagement.js';
import { readVenueTagAliases } from './venueTags.js';
import type { Dish, Restaurant } from '../../shared/types.js';
import { readStoredLocation, readStoredPurposes } from '../../shared/venue.js';
import type { DB } from '../db/connection.js';
import type { DishWrite } from '../lib/dishValidation.js';
import type { RestaurantWrite } from '../lib/restaurantValidation.js';

/**
 * The legacy `category` column is no longer read: migration 5 copied it into sections_json, and
 * every write keeps it equal to the first section (or '') so a rollback still sees a category.
 */
interface DishRow {
  id: string;
  name: string;
  image_asset_id: string | null;
  sections_json: string;
  tags: string;
  description: string;
  recipe_url: string | null;
  ingredients_json: string;
  total_minutes: number | null;
  active_minutes: number | null;
  serving_text: string;
  shopping_note: string;
  active: number;
  created_at: string;
  updated_at: string;
}

/**
 * The legacy `cuisine` (merged into tags by migration 3) and `link_url`/`link_label` (moved into
 * links_json by migration 4) columns still exist but are no longer read.
 */
interface RestaurantRow {
  id: string;
  name: string;
  image_asset_id: string | null;
  review: string;
  tags: string;
  budget_text: string;
  address: string;
  map_url: string | null;
  links_json: string;
  note: string;
  country: string;
  country_code: string;
  region: string;
  city: string;
  location_source: string;
  purposes_json: string;
  treat_types_json: string;
  active: number;
  created_at: string;
  updated_at: string;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseTags(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function toDish(r: DishRow): Dish {
  const sections = readStoredSections(parseJson(r.sections_json));
  return {
    id: r.id,
    name: r.name,
    imageAssetId: r.image_asset_id,
    category: sections[0] ?? '',
    sections,
    tags: parseTags(r.tags),
    description: r.description,
    recipeUrl: r.recipe_url,
    ingredients: readStoredIngredients(parseJson(r.ingredients_json)),
    totalMinutes: readMinutes(r.total_minutes),
    activeMinutes: readMinutes(r.active_minutes),
    servingText: r.serving_text,
    shoppingNote: r.shopping_note,
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Written dish columns; `category` mirrors the first section for older readers. */
const DISH_COLUMNS = [
  'name',
  'image_asset_id',
  'category',
  'sections_json',
  'tags',
  'description',
  'recipe_url',
  'ingredients_json',
  'total_minutes',
  'active_minutes',
  'serving_text',
  'shopping_note',
  'active',
] as const;

/** Values for DISH_COLUMNS, in the same order. */
const dishValues = (input: DishWrite) => [
  input.name,
  input.imageAssetId,
  input.sections[0] ?? '',
  JSON.stringify(input.sections),
  JSON.stringify(input.tags),
  input.description,
  input.recipeUrl,
  JSON.stringify(input.ingredients),
  input.totalMinutes,
  input.activeMinutes,
  input.servingText,
  input.shoppingNote,
  input.active ? 1 : 0,
];

/** Written restaurant columns (besides id and timestamps). */
const RESTAURANT_COLUMNS = [
  'name',
  'image_asset_id',
  'review',
  'tags',
  'budget_text',
  'address',
  'map_url',
  'links_json',
  'note',
  'country',
  'country_code',
  'region',
  'city',
  'location_source',
  'purposes_json',
  'treat_types_json',
  'active',
] as const;

/** Values for RESTAURANT_COLUMNS, in the same order. */
const restaurantValues = (input: RestaurantWrite) => [
  input.name,
  input.imageAssetId,
  input.review,
  JSON.stringify(input.tags),
  input.budgetText,
  input.address,
  input.mapUrl,
  JSON.stringify(input.links),
  input.note,
  input.location.country,
  input.location.countryCode,
  input.location.region,
  input.location.city,
  input.location.source,
  JSON.stringify(input.purposes),
  JSON.stringify(venueTagTypes(input.tags)),
  input.active ? 1 : 0,
];

const toRestaurant = (r: RestaurantRow): Restaurant => ({
  id: r.id,
  name: r.name,
  imageAssetId: r.image_asset_id,
  review: r.review,
  tags: parseTags(r.tags),
  budgetText: r.budget_text,
  address: r.address,
  mapUrl: r.map_url,
  links: readStoredLinks(parseJson(r.links_json)),
  note: r.note,
  location: readStoredLocation({
    country: r.country,
    countryCode: r.country_code,
    region: r.region,
    city: r.city,
    source: r.location_source,
  }),
  purposes: readStoredPurposes(parseJson(r.purposes_json)),
  treatTypes: venueTagTypes(parseTags(r.tags)),
  active: r.active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createCatalogRepo(db: DB) {
  const isReferenced = db.prepare('SELECT 1 FROM plan_refs WHERE kind = ? AND item_id = ? LIMIT 1');
  const venueValues = (input: RestaurantWrite) => restaurantValues({ ...input, tags: canonicalVenueTags(input.tags, readVenueTagAliases(db)) });

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

    createDish(input: DishWrite, now: Date): Dish {
      const id = randomUUID();
      const ts = now.toISOString();
      const columns = ['id', ...DISH_COLUMNS, 'created_at', 'updated_at'];
      db.prepare(`INSERT INTO dishes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
        id,
        ...dishValues(input),
        ts,
        ts,
      );
      return this.getDish(id)!;
    },

    updateDish(id: string, input: DishWrite, now: Date): Dish | null {
      const assignments = [...DISH_COLUMNS, 'updated_at'].map((c) => `${c} = ?`).join(', ');
      const result = db
        .prepare(`UPDATE dishes SET ${assignments} WHERE id = ?`)
        .run(...dishValues(input), now.toISOString(), id);
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

    createRestaurant(input: RestaurantWrite, now: Date): Restaurant {
      const id = randomUUID();
      const ts = now.toISOString();
      const columns = ['id', ...RESTAURANT_COLUMNS, 'created_at', 'updated_at'];
      db.prepare(`INSERT INTO restaurants (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
        id,
        ...venueValues(input),
        ts,
        ts,
      );
      return this.getRestaurant(id)!;
    },

    /** The legacy single link columns are cleared on every write (links_json is the only source). */
    updateRestaurant(id: string, input: RestaurantWrite, now: Date): Restaurant | null {
      const assignments = [...RESTAURANT_COLUMNS, 'updated_at'].map((c) => `${c} = ?`).join(', ');
      const result = db
        .prepare(`UPDATE restaurants SET ${assignments}, link_url = NULL, link_label = '' WHERE id = ?`)
        .run(...venueValues(input), now.toISOString(), id);
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

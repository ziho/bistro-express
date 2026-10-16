import type { Restaurant } from '../../../shared/types';

/** Every restaurant field that search matches against (tags are the classification). */
export function restaurantSearchFields(r: Restaurant): string[] {
  return [r.name, r.review, r.address, r.note, r.budgetText, ...r.tags];
}

export interface RestaurantFilter {
  q: string;
  tag: string;
  onlySelected: boolean;
}

/** Case-insensitive substring search plus optional tag / "only selected" filters. */
export function filterRestaurants(restaurants: Restaurant[], filter: RestaurantFilter, selected: ReadonlySet<string>): Restaurant[] {
  const needle = filter.q.trim().toLowerCase();
  return restaurants.filter(
    (r) =>
      (!filter.tag || r.tags.includes(filter.tag)) &&
      (!filter.onlySelected || selected.has(r.id)) &&
      (!needle || restaurantSearchFields(r).some((f) => f.toLowerCase().includes(needle))),
  );
}

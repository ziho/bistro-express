import type { Restaurant } from '../../../shared/types';
import { emptyVenueFilter, filterVenues, venueSearchFields } from '../../../shared/venueFilter';

/** Every restaurant field that search matches against (tags are the classification, plus the location). */
export const restaurantSearchFields = (r: Restaurant): string[] => venueSearchFields(r);

export interface RestaurantFilter {
  q: string;
  tag: string;
  onlySelected: boolean;
}

/** Single-tag shorthand of the shared venue filter (see shared/venueFilter for multi-tag / place filters). */
export function filterRestaurants(restaurants: Restaurant[], filter: RestaurantFilter, selected: ReadonlySet<string>): Restaurant[] {
  return filterVenues(
    restaurants,
    { ...emptyVenueFilter(), q: filter.q, tags: filter.tag ? [filter.tag] : [], onlySelected: filter.onlySelected },
    selected,
  );
}

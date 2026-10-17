import { dishSearchFields, orderSections } from '../../../shared/dish';
import type { Dish } from '../../../shared/types';

export interface DishFilter {
  q: string;
  /** Menu section; '' = any (dishes without a section are included). */
  group: string;
  tag: string;
  onlySelected: boolean;
}

/** Sections actually used by these dishes: suggested ones first, then the rest. Nothing fixed is added. */
export function dishSectionOptions(dishes: readonly Pick<Dish, 'sections'>[]): string[] {
  return orderSections(dishes.flatMap((d) => d.sections));
}

/**
 * Case-insensitive search over name, sections, tags, description and recorded ingredients, plus
 * optional section / tag / "only selected" filters. Section matching is array membership, so a
 * dish in two sections is found under either.
 */
export function filterDishes(dishes: Dish[], filter: DishFilter, selected: ReadonlySet<string>): Dish[] {
  const needle = filter.q.trim().toLowerCase();
  return dishes.filter(
    (d) =>
      (!filter.group || d.sections.includes(filter.group)) &&
      (!filter.tag || d.tags.includes(filter.tag)) &&
      (!filter.onlySelected || selected.has(d.id)) &&
      (!needle || dishSearchFields(d).some((f) => f.toLowerCase().includes(needle))),
  );
}

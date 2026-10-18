import type { VenueFilter } from './venueFilter.js';

export type VenueTagAliases = Record<string, string>;
export interface ManagedVenueTag { name: string; count: number; activeCount: number; oldNames: string[] }
export interface VenueTagIndex { tags: ManagedVenueTag[]; aliases: VenueTagAliases }
export interface VenueTagChange { sources: string[]; target: string }
export interface VenueTagPreview extends VenueTagChange {
  fingerprint: string;
  affected: number;
  inactive: number;
  targetCount: number;
  resultCount: number;
  overlap: number;
  shops: { id: string; name: string; active: boolean }[];
  moreShops: number;
}
export interface VenueTagResult { affected: number; target: string; merged: boolean }

/** The server keeps aliases flat. Own-property lookup also handles names such as constructor. */
export function canonicalVenueTag(name: string, aliases: VenueTagAliases): string {
  return Object.hasOwn(aliases, name) && typeof aliases[name] === 'string' ? aliases[name]! : name;
}
export const canonicalVenueTags = (names: readonly string[], aliases: VenueTagAliases) =>
  [...new Set(names.map((name) => canonicalVenueTag(name, aliases)))];

/** Only tag selections change. Search, date, location, ANY/ALL and candidate choices stay put. */
export function reconcileVenueTagFilter(filter: VenueFilter, aliases: VenueTagAliases): VenueFilter {
  const tags = canonicalVenueTags(filter.tags, aliases);
  return tags.length === filter.tags.length && tags.every((tag, i) => tag === filter.tags[i]) ? filter : { ...filter, tags };
}

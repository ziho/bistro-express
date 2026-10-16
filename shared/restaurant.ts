import { DEFAULT_LINK_LABEL } from './constants.js';
import type { RestaurantLink } from './types.js';

/** Separators accepted between tags in the admin form (and when splitting a legacy cuisine). */
const TAG_SEPARATORS = /[\s,，、#]+/;

/** Splits free text into unique, trimmed tags, keeping their order. */
export function splitTags(raw: string): string[] {
  return [...new Set(raw.split(TAG_SEPARATORS).map((t) => t.trim()).filter(Boolean))];
}

/** Control characters and any whitespace (incl. U+2028/U+2029), which browsers strip or mangle in an href. */
const UNSAFE_URL_CHARS = /[\x00-\x1f\x7f-\x9f\s]/;

/**
 * A link that is safe to render as an `<a href>` for the guest: absolute http(s), a host,
 * no embedded credentials and no whitespace/control characters.
 */
export function isSafeExternalUrl(value: string): boolean {
  if (!value || UNSAFE_URL_CHARS.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Reads stored links (a parsed `links_json` column or a snapshot's `links`) of any quality:
 * anything that is not a `{ label?, url }` object with a non-empty string URL is skipped.
 * Safety is checked again at render time by `restaurantLinks`.
 */
export function readStoredLinks(raw: unknown): RestaurantLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): RestaurantLink[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { label, url } = entry as Record<string, unknown>;
    if (typeof url !== 'string' || !url) return [];
    return [{ label: typeof label === 'string' ? label : '', url }];
  });
}

/** One legacy single link (linkUrl/linkLabel) as a links array; empty when there was no URL. */
export function legacyLink(linkUrl: unknown, linkLabel: unknown): RestaurantLink[] {
  const url = typeof linkUrl === 'string' ? linkUrl.trim() : '';
  if (!url) return [];
  return [{ label: typeof linkLabel === 'string' ? linkLabel.trim() : '', url }];
}

export interface LinkAction {
  href: string;
  label: string;
}

/** The external link actions to show for a restaurant (or snapshot): only safe URLs, with a display name. */
export function restaurantLinks(item: { links: RestaurantLink[] }): LinkAction[] {
  return item.links
    .filter((l) => isSafeExternalUrl(l.url))
    .map((l) => ({ href: l.url, label: l.label.trim() || DEFAULT_LINK_LABEL }));
}

import { DEFAULT_LINK_LABEL } from './constants.js';

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

/** The external link action to show for a restaurant (or snapshot), or null when there is none. */
export function restaurantLink(item: { linkUrl: string | null; linkLabel: string }): { href: string; label: string } | null {
  if (!item.linkUrl || !isSafeExternalUrl(item.linkUrl)) return null;
  return { href: item.linkUrl, label: item.linkLabel.trim() || DEFAULT_LINK_LABEL };
}

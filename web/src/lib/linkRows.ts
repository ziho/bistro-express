import { LIMITS } from '../../../shared/constants';
import { isSafeExternalUrl } from '../../../shared/restaurant';
import type { RestaurantLink } from '../../../shared/types';

/** One row of the restaurant links editor. `key` is stable for the row's lifetime (React key, ids, focus). */
export interface LinkRow {
  key: string;
  label: string;
  url: string;
}

export interface LinkRowError {
  label?: string;
  url?: string;
}

let nextKey = 0;

export function newLinkRow(link: RestaurantLink = { label: '', url: '' }): LinkRow {
  nextKey += 1;
  return { key: `link-${nextKey}`, label: link.label, url: link.url };
}

/** Editor rows for a restaurant's links; one blank row when it has none, so the fields are ready to fill. */
export function toLinkRows(links: RestaurantLink[]): LinkRow[] {
  return links.length ? links.map((l) => newLinkRow(l)) : [newLinkRow()];
}

/**
 * Validates the rows the way the server does. Rows with neither name nor URL are unused and
 * dropped; a name without a URL, an unsafe URL or an over-long name is an error on that row.
 * Nothing is truncated or dropped silently.
 */
export function collectLinks(rows: LinkRow[]): { links: RestaurantLink[]; errors: Record<string, LinkRowError> } {
  const links: RestaurantLink[] = [];
  const errors: Record<string, LinkRowError> = {};
  for (const row of rows) {
    const label = row.label.trim().replace(/\s+/g, ' ');
    const url = row.url.trim();
    if (!label && !url) continue;
    const error: LinkRowError = {};
    if (label.length > LIMITS.linkLabel) error.label = `名称不能超过 ${LIMITS.linkLabel} 个字`;
    if (!url) error.url = '请填写这个链接的网址';
    else if (url.length > LIMITS.url) error.url = `网址不能超过 ${LIMITS.url} 个字符`;
    else if (!isSafeExternalUrl(url)) error.url = '请填写以 http:// 或 https:// 开头的完整网址（不能含空格）';
    if (error.label || error.url) errors[row.key] = error;
    else links.push({ label, url });
  }
  return { links, errors };
}

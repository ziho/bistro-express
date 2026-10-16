import { ArrowUpRight, ExternalLink, MapPin } from 'lucide-react';
import { CARD_QUICK_LINKS } from '../../../shared/constants';
import { restaurantLinks, type LinkAction } from '../../../shared/restaurant';
import type { RestaurantLink } from '../../../shared/types';

/** Read-only tag chips (分类标签). Renders nothing when there are no tags. */
export function TagList({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className={`tag-list ${className ?? ''}`} aria-label="分类标签">
      {tags.map((t) => (
        <li key={t} className="tag">
          #{t}
        </li>
      ))}
    </ul>
  );
}

const NEW_WINDOW = { target: '_blank', rel: 'noopener noreferrer' } as const;

/** Host name shown under a link in the full list, so it is clear where the link goes. */
function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface QuickLinksProps {
  links: RestaurantLink[];
  /** Restaurant name, so screen readers can tell links of different cards apart. */
  name: string;
  /** Opens the details sheet, which lists every link. */
  onShowAll: () => void;
}

/**
 * The first few links of a restaurant card. Each link only opens a new tab (never part of the
 * selection control); any further links are reachable through the "more" button.
 */
export function RestaurantQuickLinks({ links, name, onShowAll }: QuickLinksProps) {
  const actions = restaurantLinks({ links });
  if (actions.length === 0) return null;
  const shown = actions.slice(0, CARD_QUICK_LINKS);
  const more = actions.length - shown.length;
  return (
    <ul className="link-list" aria-label={`${name}的相关链接`}>
      {shown.map((link, i) => (
        <li key={`${i}-${link.href}`}>
          <a className="link-chip" href={link.href} {...NEW_WINDOW}>
            <span>{link.label}</span>
            <ArrowUpRight aria-hidden="true" />
            <span className="sr-only">（{name}，新窗口打开）</span>
          </a>
        </li>
      ))}
      {more > 0 && (
        <li>
          <button type="button" className="link-chip link-chip-more" onClick={onShowAll}>
            还有 {more} 个链接
            <span className="sr-only">，查看{name}的全部链接</span>
          </button>
        </li>
      )}
    </ul>
  );
}

function LinkRow({ link, name }: { link: LinkAction; name: string }) {
  const host = hostOf(link.href);
  return (
    <a className="link-row" href={link.href} {...NEW_WINDOW}>
      <ExternalLink aria-hidden="true" />
      <span className="link-row-text">
        <span className="link-row-label">{link.label}</span>
        {host && <span className="link-row-host">{host}</span>}
      </span>
      <span className="sr-only">（{name}，新窗口打开）</span>
    </a>
  );
}

/** Every link of a restaurant (details sheet, saved plan), one per row. */
export function RestaurantLinkRows({ links, name }: { links: RestaurantLink[]; name: string }) {
  const actions = restaurantLinks({ links });
  if (actions.length === 0) return null;
  return (
    <ul className="link-rows" aria-label={`${name}的相关链接`}>
      {actions.map((link, i) => (
        <li key={`${i}-${link.href}`}>
          <LinkRow link={link} name={name} />
        </li>
      ))}
    </ul>
  );
}

export function MapLinkButton({ mapUrl, className = 'btn btn-ghost btn-sm' }: { mapUrl: string | null; className?: string }) {
  if (!mapUrl) return null;
  return (
    <a className={`${className} btn-wrap`} href={mapUrl} {...NEW_WINDOW}>
      <MapPin aria-hidden="true" />
      <span>打开地图</span>
    </a>
  );
}

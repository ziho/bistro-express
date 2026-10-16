import { ExternalLink, MapPin } from 'lucide-react';
import { restaurantLink } from '../../../shared/restaurant';

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

interface LinkProps {
  item: { linkUrl: string | null; linkLabel: string };
  /** Restaurant name, so screen readers can tell several link buttons apart. */
  name: string;
  className?: string;
}

/** The restaurant's menu / website link. Opens in a new tab; never part of a selection control. */
export function RestaurantLinkButton({ item, name, className = 'btn btn-ghost btn-sm' }: LinkProps) {
  const link = restaurantLink(item);
  if (!link) return null;
  return (
    <a className={`${className} btn-wrap`} href={link.href} target="_blank" rel="noopener noreferrer">
      <ExternalLink aria-hidden="true" />
      <span>{link.label}</span>
      <span className="sr-only">（{name}，新窗口打开）</span>
    </a>
  );
}

export function MapLinkButton({ mapUrl, className = 'btn btn-ghost btn-sm' }: { mapUrl: string | null; className?: string }) {
  if (!mapUrl) return null;
  return (
    <a className={`${className} btn-wrap`} href={mapUrl} target="_blank" rel="noopener noreferrer">
      <MapPin aria-hidden="true" />
      <span>打开地图</span>
    </a>
  );
}

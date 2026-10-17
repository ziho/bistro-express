import { useState } from 'react';
import { mediaUrl } from '../api/client';
import { FoodPlaceholder } from './Illustrations';

interface Props {
  assetId: string | null;
  name: string;
  kind?: 'dish' | 'restaurant';
  variant?: 'thumb' | 'full';
  className?: string;
  /** 'span' when rendered inside a <button> (phrasing content only). */
  as?: 'div' | 'span';
}

/** Authenticated catalog photo with an illustrated fallback (no external imagery). */
export function ItemImage({ assetId, name, kind = 'dish', variant = 'thumb', className, as: Tag = 'div' }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <Tag className={`item-image ${className ?? ''}`}>
      {assetId && !failed ? (
        <img src={mediaUrl(assetId, variant)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <FoodPlaceholder seed={name} kind={kind} />
      )}
    </Tag>
  );
}

import { useState } from 'react';
import { mediaUrl } from '../api/client';
import { FoodPlaceholder } from './Illustrations';

interface Props {
  assetId: string | null;
  name: string;
  kind?: 'dish' | 'restaurant';
  variant?: 'thumb' | 'full';
  className?: string;
}

/** Authenticated catalog photo with an illustrated fallback (no external imagery). */
export function ItemImage({ assetId, name, kind = 'dish', variant = 'thumb', className }: Props) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`item-image ${className ?? ''}`}>
      {assetId && !failed ? (
        <img src={mediaUrl(assetId, variant)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <FoodPlaceholder seed={name} kind={kind} />
      )}
    </div>
  );
}

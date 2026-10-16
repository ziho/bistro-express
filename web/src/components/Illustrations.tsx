/** Hand-drawn style line illustrations. Decorative: always aria-hidden. */

const stroke = { stroke: 'var(--ink)', strokeWidth: 3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function TableForTwo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 180" aria-hidden="true" focusable="false">
      <ellipse cx="160" cy="150" rx="140" ry="16" fill="var(--cream-2)" />
      <path d="M30 120h260" {...stroke} />
      {/* left plate */}
      <ellipse cx="95" cy="112" rx="52" ry="12" fill="var(--paper)" {...stroke} />
      <ellipse cx="95" cy="108" rx="30" ry="6" fill="var(--butter-soft)" stroke="none" />
      <circle cx="84" cy="101" r="9" fill="var(--tomato)" />
      <path d="M84 92c2-4 6-5 8-4" {...stroke} strokeWidth={2.5} fill="none" />
      <circle cx="104" cy="103" r="6" fill="var(--butter)" />
      {/* right plate */}
      <ellipse cx="225" cy="112" rx="52" ry="12" fill="var(--paper)" {...stroke} />
      <path d="M203 105c8-14 36-14 44 0" fill="var(--coral-soft)" {...stroke} />
      <path d="M212 99c3 3 7 3 10 0M226 98c3 3 7 3 10 0" {...stroke} strokeWidth={2.5} fill="none" />
      {/* cutlery */}
      <path d="M30 96v20M26 96v8c0 3 8 3 8 0v-8" {...stroke} fill="none" />
      <path d="M290 96v20M290 96c6 2 6 12 0 14" {...stroke} fill="none" />
      {/* cups */}
      <path d="M146 78h28l-3 34h-22z" fill="var(--paper)" {...stroke} />
      <path d="M150 90h20" stroke="var(--coral)" strokeWidth={6} strokeLinecap="round" />
      {/* heart steam */}
      <path d="M160 64c-6-8-16-2-10 6l10 9 10-9c6-8-4-14-10-6z" fill="var(--coral)" stroke="none" />
    </svg>
  );
}

export function Cloche({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 140" aria-hidden="true" focusable="false">
      <ellipse cx="100" cy="122" rx="80" ry="10" fill="var(--cream-2)" />
      <path d="M30 108h140" {...stroke} />
      <path d="M40 106c0-40 26-62 60-62s60 22 60 62z" fill="var(--butter-soft)" {...stroke} />
      <path d="M62 82c6-12 16-20 28-22" stroke="var(--paper)" strokeWidth={6} strokeLinecap="round" fill="none" />
      <circle cx="100" cy="38" r="7" fill="var(--tomato)" {...stroke} />
      <path d="M150 34l6-6M160 46l9-2M144 24l2-8" stroke="var(--coral)" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export function TomatoMascot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle cx="60" cy="66" r="40" fill="var(--tomato)" {...stroke} />
      <path d="M44 30c6 6 10 8 16 8s10-2 16-8c-4 10-8 12-16 12s-12-2-16-12z" fill="var(--leaf)" {...stroke} strokeWidth={2.5} />
      <path d="M60 30v-10" {...stroke} />
      <circle cx="47" cy="64" r="4" fill="var(--ink)" />
      <circle cx="73" cy="64" r="4" fill="var(--ink)" />
      <path d="M52 78c4 5 12 5 16 0" {...stroke} strokeWidth={2.5} fill="none" />
      <ellipse cx="40" cy="74" rx="6" ry="3.5" fill="var(--coral-soft)" />
      <ellipse cx="80" cy="74" rx="6" ry="3.5" fill="var(--coral-soft)" />
      <path d="M38 50c3-6 8-9 13-10" stroke="var(--paper)" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.7} />
    </svg>
  );
}

export function EmptyPlate({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 110" aria-hidden="true" focusable="false">
      <ellipse cx="80" cy="62" rx="62" ry="30" fill="var(--paper)" {...stroke} />
      <ellipse cx="80" cy="60" rx="38" ry="16" fill="none" stroke="var(--line)" strokeWidth={3} />
      <path d="M8 40v40M4 40v12c0 4 8 4 8 0V40" {...stroke} fill="none" />
      <path d="M152 40v40M152 40c7 3 7 16 0 18" {...stroke} fill="none" />
      <path d="M70 58c3 3 7 3 10 0M86 58c3 3 7 3 10 0" stroke="var(--muted)" strokeWidth={2.5} strokeLinecap="round" fill="none" />
    </svg>
  );
}

const FOOD_VARIANTS = ['bowl', 'noodles', 'salad', 'skewer'] as const;

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Illustrated placeholder for catalog items without a photo; varies by name. */
export function FoodPlaceholder({ seed, kind = 'dish' }: { seed: string; kind?: 'dish' | 'restaurant' }) {
  const h = hashString(seed);
  const bg = ['var(--butter-soft)', 'var(--coral-soft)', 'var(--leaf-soft)', 'var(--cream-2)'][h % 4];
  if (kind === 'restaurant') {
    return (
      <svg className="placeholder-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false" style={{ background: bg }}>
        <path d="M30 56h100v44H30z" fill="var(--paper)" {...stroke} />
        <path d="M24 56l10-22h92l10 22z" fill="var(--tomato)" {...stroke} />
        <path d="M44 56c0 8 14 8 14 0M72 56c0 8 16 8 16 0M102 56c0 8 14 8 14 0" fill="var(--paper)" {...stroke} strokeWidth={2.5} />
        <path d="M70 100V76h20v24" fill="var(--butter)" {...stroke} />
        <rect x="40" y="72" width="20" height="14" rx="3" fill="var(--sky-soft)" {...stroke} strokeWidth={2.5} />
        <rect x="100" y="72" width="20" height="14" rx="3" fill="var(--sky-soft)" {...stroke} strokeWidth={2.5} />
      </svg>
    );
  }
  const variant = FOOD_VARIANTS[h % FOOD_VARIANTS.length];
  return (
    <svg className="placeholder-art" viewBox="0 0 160 120" aria-hidden="true" focusable="false" style={{ background: bg }}>
      <ellipse cx="80" cy="96" rx="58" ry="10" fill="var(--paper)" opacity={0.7} />
      {variant === 'bowl' && (
        <>
          <path d="M34 62h92c0 26-20 40-46 40S34 88 34 62z" fill="var(--paper)" {...stroke} />
          <circle cx="62" cy="56" r="10" fill="var(--tomato)" {...stroke} strokeWidth={2.5} />
          <circle cx="86" cy="54" r="12" fill="var(--butter)" {...stroke} strokeWidth={2.5} />
          <path d="M100 58c4-8 12-10 16-6" stroke="var(--leaf)" strokeWidth={5} strokeLinecap="round" fill="none" />
        </>
      )}
      {variant === 'noodles' && (
        <>
          <path d="M34 62h92c0 26-20 40-46 40S34 88 34 62z" fill="var(--paper)" {...stroke} />
          <path d="M48 62c4-10 10 4 14-6s10 4 14-6 10 4 14-6 10 4 14-4" stroke="var(--butter-strong)" strokeWidth={4} fill="none" strokeLinecap="round" />
          <path d="M96 22l-18 44M108 24l-24 42" {...stroke} />
        </>
      )}
      {variant === 'salad' && (
        <>
          <ellipse cx="80" cy="74" rx="50" ry="20" fill="var(--paper)" {...stroke} />
          <circle cx="62" cy="66" r="9" fill="var(--leaf)" {...stroke} strokeWidth={2.5} />
          <circle cx="80" cy="62" r="10" fill="var(--tomato)" {...stroke} strokeWidth={2.5} />
          <circle cx="98" cy="68" r="8" fill="var(--butter)" {...stroke} strokeWidth={2.5} />
        </>
      )}
      {variant === 'skewer' && (
        <>
          <ellipse cx="80" cy="78" rx="54" ry="16" fill="var(--paper)" {...stroke} />
          <path d="M36 70l90-30" {...stroke} />
          <rect x="52" y="54" width="16" height="16" rx="5" transform="rotate(-18 60 62)" fill="var(--tomato)" {...stroke} strokeWidth={2.5} />
          <rect x="74" y="46" width="16" height="16" rx="5" transform="rotate(-18 82 54)" fill="var(--butter)" {...stroke} strokeWidth={2.5} />
          <rect x="96" y="39" width="16" height="16" rx="5" transform="rotate(-18 104 47)" fill="var(--leaf)" {...stroke} strokeWidth={2.5} />
        </>
      )}
    </svg>
  );
}

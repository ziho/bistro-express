import { useId } from 'react';
import type { VenuePurpose } from '../../../shared/types';
import { VENUE_ENTRY_LABEL, VENUE_PURPOSES } from '../../../shared/venue';
import { togglePurpose } from '../lib/venueForm';

export function VenueEntryField({ value, onChange, error }: { value: VenuePurpose[]; onChange: (next: VenuePurpose[]) => void; error?: string }) {
  const id = useId();
  return <fieldset className="field venue-purpose">
    <legend className="field-label">前台入口 <span className="muted small">（可都选）</span></legend>
    <div className="chip-row">{VENUE_PURPOSES.map((p) => <label key={p} className="chip chip-radio">
      <input type="checkbox" checked={value.includes(p)} onChange={() => onChange(togglePurpose(value, p))}
        aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`} />
      <span>{VENUE_ENTRY_LABEL[p]}</span>
    </label>)}</div>
    <p id={`${id}-hint`} className="field-hint">决定店铺在哪儿出现，可以都选。</p>
    {error && <p id={`${id}-err`} className="field-error">{error}</p>}
  </fieldset>;
}

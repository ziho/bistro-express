import { normalizeTreatTypes } from '../../../shared/treatType';
import type { LocationSuggestion, Restaurant, TreatType, VenueLocation, VenuePurpose } from '../../../shared/types';
import { hasUnsafeText, LOCATION_LIMITS, normalizeLocationText, normalizePurposes } from '../../../shared/venue';
import { mergeAutofill, type AutofillMerge } from './mapImport';

/**
 * Editable location of a venue form (single form and bulk rows share these rules):
 * - a suggestion only fills empty fields or fields that still hold an earlier suggestion;
 *   anything typed by hand is kept and reported as a conflict to replace explicitly;
 * - the ISO country code follows its country name — typing another country drops it;
 * - the saved source is 'osm' only while every filled field is exactly what the lookup suggested.
 */

export type LocationField = 'country' | 'region' | 'city';
export const LOCATION_FIELDS: LocationField[] = ['country', 'region', 'city'];
export const LOCATION_FIELD_LABEL: Record<LocationField, string> = { country: '国家/地区', region: '省/州', city: '城市' };

export interface LocationFormState {
  values: Record<LocationField, string>;
  /** Values written from an OpenStreetMap suggestion (to recognise untouched ones later). */
  autofilled: Partial<Record<LocationField, string>>;
  /** Country name → ISO code known for it (from the saved venue or a suggestion). */
  codes: Record<string, string>;
}

export function toLocationForm(location: VenueLocation | null | undefined): LocationFormState {
  const l = location ?? { country: '', countryCode: '', region: '', city: '', source: '' as const };
  const values = { country: l.country, region: l.region, city: l.city };
  return {
    values,
    autofilled: l.source === 'osm' ? { ...values } : {},
    codes: l.country && l.countryCode ? { [l.country]: l.countryCode } : {},
  };
}

export const editLocation = (s: LocationFormState, field: LocationField, value: string): LocationFormState => ({
  ...s,
  values: { ...s.values, [field]: value },
});

export interface SuggestionMerge {
  state: LocationFormState;
  conflicts: AutofillMerge<LocationField>['conflicts'];
}

export function applySuggestion(s: LocationFormState, suggestion: LocationSuggestion): SuggestionMerge {
  const merged = mergeAutofill(LOCATION_FIELDS, s.values, s.autofilled, suggestion);
  const codes = suggestion.country && suggestion.countryCode ? { ...s.codes, [suggestion.country]: suggestion.countryCode } : s.codes;
  return { state: { values: { ...s.values, ...merged.updates }, autofilled: merged.autofilled, codes }, conflicts: merged.conflicts };
}

/** Explicit 「用建议替换」 for one field (or every field). */
export function replaceWithSuggestion(s: LocationFormState, suggestion: LocationSuggestion, fields: readonly LocationField[]): LocationFormState {
  const values = { ...s.values };
  const autofilled = { ...s.autofilled };
  for (const f of fields) {
    values[f] = suggestion[f];
    autofilled[f] = suggestion[f];
  }
  const codes = suggestion.country && suggestion.countryCode ? { ...s.codes, [suggestion.country]: suggestion.countryCode } : s.codes;
  return { values, autofilled, codes };
}

export type LocationProblems = Partial<Record<LocationField, string>>;

export function locationProblems(s: LocationFormState): LocationProblems {
  const problems: LocationProblems = {};
  for (const f of LOCATION_FIELDS) {
    const v = normalizeLocationText(s.values[f]);
    if (hasUnsafeText(v)) problems[f] = `${LOCATION_FIELD_LABEL[f]}包含不支持的字符`;
    else if (v.length > LOCATION_LIMITS[f]) problems[f] = `${LOCATION_FIELD_LABEL[f]}不能超过 ${LOCATION_LIMITS[f]} 个字`;
  }
  return problems;
}

/** What the form sends: always every key, so an emptied field really clears the stored value. */
export function locationPayload(s: LocationFormState): VenueLocation {
  const v = {
    country: normalizeLocationText(s.values.country),
    region: normalizeLocationText(s.values.region),
    city: normalizeLocationText(s.values.city),
  };
  const filled = LOCATION_FIELDS.filter((f) => v[f]);
  if (filled.length === 0) return { ...v, countryCode: '', source: '' };
  const fromOsm = LOCATION_FIELDS.every((f) => (v[f] ? v[f] === s.autofilled[f] : !s.autofilled[f]));
  return { ...v, countryCode: s.codes[v.country] ?? '', source: fromOsm ? 'osm' : 'manual' };
}

export const togglePurpose = (list: readonly VenuePurpose[], p: VenuePurpose): VenuePurpose[] =>
  normalizePurposes(list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);

export const toggleTreatType = (list: readonly TreatType[], t: TreatType): TreatType[] =>
  normalizeTreatTypes(list.includes(t) ? list.filter((x) => x !== t) : [...list, t]);

/** Location values already used by venues, offered for reuse in forms (no global place list). */
export function venueLocationOptions(venues: readonly Restaurant[]): Record<LocationField, string[]> {
  const pick = (f: LocationField) => [...new Set(venues.map((r) => r.location[f]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
  return { country: pick('country'), region: pick('region'), city: pick('city') };
}

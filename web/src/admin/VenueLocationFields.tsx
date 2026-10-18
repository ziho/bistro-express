import { useMutation } from '@tanstack/react-query';
import { MapPinned, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { GeoOutcome, LocationSuggestion, MapLinkPreview } from '../../../shared/types';
import { formatLocation, LOCATION_LIMITS } from '../../../shared/venue';
import { api, ApiError } from '../api/client';
import { OsmAttribution } from '../components/RestaurantBits';
import {
  applySuggestion,
  editLocation,
  LOCATION_FIELD_LABEL,
  LOCATION_FIELDS,
  replaceWithSuggestion,
  type LocationField,
  type LocationFormState,
  type LocationProblems,
} from '../lib/venueForm';

export type LocationOptions = Record<LocationField, string[]>;

interface Props {
  state: LocationFormState;
  onChange: (next: LocationFormState) => void;
  /** The form's current map link: 「识别地区」 looks up its own place point. */
  mapUrl: string;
  /** Region result that arrived with 「识别链接」 (add form). */
  incoming: { outcome: GeoOutcome; at: number } | null;
  options: LocationOptions;
  problems: LocationProblems;
}

const PLACEHOLDER: Record<LocationField, string> = { country: '比如：加拿大', region: '比如：British Columbia（城市国家可不填）', city: '比如：Burnaby' };

/** Optional 国家/地区 · 省/州 · 城市 for the venue form. Suggestions never overwrite typing silently. */
export function VenueLocationFields({ state, onChange, mapUrl, incoming, options, problems }: Props) {
  const id = useId();
  const latestMapUrl = useRef(mapUrl);
  latestMapUrl.current = mapUrl;
  const [outcome, setOutcome] = useState<GeoOutcome | null>(null);
  const [conflicts, setConflicts] = useState<{ field: LocationField; current: string; incoming: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const receive = (next: GeoOutcome) => {
    setOutcome(next);
    if (next.status !== 'suggested') {
      setConflicts([]);
      return;
    }
    const merged = applySuggestion(state, next.suggestion);
    onChange(merged.state);
    setConflicts(merged.conflicts);
  };

  useEffect(() => {
    if (incoming) receive(incoming.outcome);
    // Only a new result (identified by its timestamp) is applied; later typing is never re-merged.
  }, [incoming?.at]);

  const identify = useMutation({
    mutationFn: (url: string) => api<MapLinkPreview>('POST', '/admin/restaurants/resolve-map-link', { json: { url, geo: true } }),
    onMutate: () => setError(null),
    onSuccess: (p, sent) => {
      if (latestMapUrl.current.trim() !== sent) return;
      if (p.geo) receive(p.geo);
      else setError('这次没有返回地区建议，请手动填写');
    },
    onError: (err, sent) => {
      if (latestMapUrl.current.trim() === sent) setError(err instanceof ApiError ? err.message : '识别失败，请稍后再试或手动填写');
    },
  });

  const replace = (s: LocationSuggestion, fields: readonly LocationField[]) => {
    onChange(replaceWithSuggestion(state, s, fields));
    setConflicts((prev) => prev.filter((c) => !fields.includes(c.field)));
  };

  const suggestion = outcome?.status === 'suggested' ? outcome.suggestion : null;

  return (
    <>
      <fieldset className="field venue-location">
        <legend className="field-label">
          地区 <span className="muted small">（可选，城市按实际所在填写，如 Burnaby 不写成 Vancouver）</span>
        </legend>
        <div className="location-grid">
          {LOCATION_FIELDS.map((f) => (
            <div key={f} className="bulk-field">
              <label className="bulk-field-label" htmlFor={`${id}-${f}`}>
                {LOCATION_FIELD_LABEL[f]}
              </label>
              <input
                id={`${id}-${f}`}
                className="input"
                list={options[f].length ? `${id}-${f}-list` : undefined}
                maxLength={LOCATION_LIMITS[f] * 2}
                placeholder={PLACEHOLDER[f]}
                value={state.values[f]}
                aria-invalid={problems[f] ? true : undefined}
                aria-describedby={problems[f] ? `${id}-${f}-err` : undefined}
                onChange={(e) => onChange(editLocation(state, f, e.target.value))}
              />
              {options[f].length > 0 && (
                <datalist id={`${id}-${f}-list`}>
                  {options[f].map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              )}
              {problems[f] && (
                <p id={`${id}-${f}-err`} className="field-error">
                  {problems[f]}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="location-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!mapUrl.trim() || identify.isPending}
            onClick={() => identify.mutate(mapUrl.trim())}
          >
            <MapPinned aria-hidden="true" /> {identify.isPending ? '识别中…' : '从地图链接识别地区'}
          </button>
          {!mapUrl.trim() && <span className="muted small">先填写地图链接</span>}
        </div>
        <div aria-live="polite">
          {error && <p className="field-error">{error}</p>}
          {outcome && outcome.status !== 'suggested' && (
            <p className="notice notice-butter small">
              <TriangleAlert aria-hidden="true" />
              <span>{outcome.message}</span>
            </p>
          )}
          {suggestion && (
            <div className="map-preview small">
              <p>
                建议地区：<strong>{formatLocation({ ...suggestion, source: 'osm' }) || '（无）'}</strong>
                {outcome?.status === 'suggested' && outcome.cached && <span className="muted">（之前识别过）</span>}
                。空着的项已填入，可以继续修改。
              </p>
              {conflicts.map((c) => (
                <div key={c.field} className="map-conflict">
                  <span>
                    「{LOCATION_FIELD_LABEL[c.field]}」是你手动填写的，已保留。建议：<strong className="break-all">{c.incoming}</strong>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => replace(suggestion, [c.field])}>
                    用建议替换
                  </button>
                </div>
              ))}
              {conflicts.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => replace(suggestion, LOCATION_FIELDS)}>
                  全部用建议替换
                </button>
              )}
              <p className="muted">
                地区数据来自 <OsmAttribution />，只识别链接里店铺自己的坐标，不保证准确，请核对。
              </p>
            </div>
          )}
        </div>
      </fieldset>
    </>
  );
}

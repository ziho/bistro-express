import { useMutation } from '@tanstack/react-query';
import { MapPinned, TriangleAlert, Wand2 } from 'lucide-react';
import { useId, useState, type SyntheticEvent } from 'react';
import { LIMITS, MAP_LINK_INPUT_MAX } from '../../../shared/constants';
import type { MapLinkPreview } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { mergeImport, type ImportConflict, type ImportField, type ImportValues } from '../lib/mapImport';

const FIELD_LABEL: Record<ImportField, string> = { name: '餐厅名', mapUrl: '地图链接' };

interface Props {
  current: ImportValues;
  onApply: (updates: Partial<ImportValues>) => void;
}

const firstLink = (text: string) => /https:\/\/\S+/i.exec(text)?.[0] ?? null;

/**
 * "Paste a Google Maps link" helper for the add-restaurant form. It only fills the form —
 * the admin still reviews and presses 保存. Fields the admin typed are never overwritten silently.
 */
export function MapLinkImport({ current, onApply }: Props) {
  const inputId = useId();
  const [link, setLink] = useState('');
  const [autofilled, setAutofilled] = useState<Partial<ImportValues>>({});
  const [preview, setPreview] = useState<MapLinkPreview | null>(null);
  const [conflicts, setConflicts] = useState<ImportConflict[]>([]);
  const [error, setError] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: (url: string) => api<MapLinkPreview>('POST', '/admin/restaurants/resolve-map-link', { json: { url } }),
    onMutate: () => setError(null),
    onSuccess: (p) => {
      const merged = mergeImport(current, autofilled, { name: p.name, mapUrl: p.mapUrl });
      onApply(merged.updates);
      setAutofilled(merged.autofilled);
      setConflicts(merged.conflicts);
      setPreview(p);
    },
    onError: (err) => {
      setPreview(null);
      setConflicts([]);
      setError(err instanceof ApiError ? err.message : '识别失败，请稍后再试');
    },
  });

  const apply = (field: ImportField, value: string) => {
    onApply({ [field]: value });
    setAutofilled((prev) => ({ ...prev, [field]: value }));
    setConflicts((prev) => prev.filter((c) => c.field !== field));
  };

  /** Also used for Enter in the input, which must not submit the surrounding restaurant form. */
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (link.trim() && !resolve.isPending) resolve.mutate(link.trim());
  };

  const candidate = error ? firstLink(link) : null;
  const fallbackLink = candidate && candidate.length <= LIMITS.url && current.mapUrl.trim() !== candidate ? candidate : null;

  return (
    <section className="map-import" aria-labelledby={`${inputId}-title`}>
      <h3 id={`${inputId}-title`} className="map-import-title">
        <MapPinned aria-hidden="true" /> 从 Google 地图链接填写（可选）
      </h3>
      <p className="muted small">
        粘贴餐厅分享链接，快速填写店名和地图链接。你可以继续修改、补充，核对后再保存。
      </p>
      {/* Not a nested <form>: the sheet already wraps the restaurant form. */}
      <div className="map-import-row" role="group" aria-label="识别 Google 地图链接">
        <label htmlFor={inputId} className="sr-only">
          Google 地图链接
        </label>
        <input
          id={inputId}
          className="input"
          type="url"
          inputMode="url"
          maxLength={MAP_LINK_INPUT_MAX}
          placeholder="https://maps.app.goo.gl/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(e);
          }}
        />
        <button type="button" className="btn btn-butter" onClick={submit} disabled={!link.trim() || resolve.isPending}>
          <Wand2 aria-hidden="true" /> {resolve.isPending ? '识别中…' : '识别链接'}
        </button>
      </div>

      <div aria-live="polite">
        {error && (
          <div className="notice notice-butter small map-import-msg">
            <TriangleAlert aria-hidden="true" />
            <div>
              <p>
                <strong>没能识别：</strong>
                {error}
              </p>
              <p>链接已保留在上面，你也可以直接在下面手动填写。</p>
              {fallbackLink && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply('mapUrl', fallbackLink)}>
                  仍把这个链接填入「地图链接」
                </button>
              )}
            </div>
          </div>
        )}
        {preview && <PreviewCard preview={preview} conflicts={conflicts} currentMapUrl={current.mapUrl} onApply={apply} />}
      </div>
    </section>
  );
}

function PreviewCard({
  preview: p,
  conflicts,
  currentMapUrl,
  onApply,
}: {
  preview: MapLinkPreview;
  conflicts: ImportConflict[];
  currentMapUrl: string;
  onApply: (field: ImportField, value: string) => void;
}) {
  const canUseSource = p.sourceUrl !== p.mapUrl && p.sourceUrl.length <= LIMITS.url && currentMapUrl.trim() !== p.sourceUrl;

  return (
    <div className="map-preview" role="status">
      <p className="success-text small">已识别{p.expanded ? '（已展开短链接）' : ''}，可填写的信息已填入下方，手动填写的内容已保留。</p>
      {p.duplicates.length > 0 && (
        <div className="notice notice-butter small map-import-msg">
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>可能已经添加过这家店：</strong>
            <ul className="map-dup-list">
              {p.duplicates.map((d) => (
                <li key={d.id}>
                  {d.name}
                  {!d.active && '（已下架）'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {conflicts.map((c) => (
        <div key={c.field} className="map-conflict small">
          <span>
            「{FIELD_LABEL[c.field]}」是你手动填写的，已保留。识别结果：<strong className="break-all">{c.incoming}</strong>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApply(c.field, c.incoming)}>
            用识别结果替换
          </button>
        </div>
      ))}
      <dl className="map-facts small">
        <dt>店名</dt>
        <dd>{p.name ? `${p.name}${p.nameSource === 'query' ? '（来自搜索词）' : ''}` : '链接里没有'}</dd>
        <dt>地点</dt>
        <dd>{p.place ? '已识别店铺位置，可打开地图核对' : '请打开地图核对分店'}</dd>
        <dt>地图链接</dt>
        <dd>{p.mapUrl ? <a href={p.mapUrl} target="_blank" rel="noopener noreferrer">在 Google Maps 中打开</a> : '请在下方补充地图链接'}</dd>
      </dl>
      {canUseSource && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApply('mapUrl', p.sourceUrl)}>
          改用原始分享链接
        </button>
      )}
      <ul className="map-notes muted small">
        {p.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

import { CircleCheck, ExternalLink, MapPinned, RotateCw, Trash2, TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { classifyMapsUrl } from '../../../../shared/mapsUrl';
import { TREAT_TYPE_LABEL, TREAT_TYPES } from '../../../../shared/treatType';
import type { RestaurantDuplicate, TreatType, VenuePurpose } from '../../../../shared/types';
import { PURPOSE_LABEL, VENUE_PURPOSES } from '../../../../shared/venue';
import { OsmAttribution } from '../../components/RestaurantBits';
import { canRetryGeo, isRetryable, type QueueRow, type RowEdit, type RowInfo, type RowProblem } from '../../lib/bulkQueue';
import { LOCATION_FIELD_LABEL, LOCATION_FIELDS, locationPayload, togglePurpose, toggleTreatType, type LocationField } from '../../lib/venueForm';

export interface RowActions {
  editLocation: (id: string, field: LocationField, value: string) => void;
  setPurposes: (id: string, purposes: VenuePurpose[]) => void;
  setTreatTypes: (id: string, types: TreatType[]) => void;
  retryGeo: (id: string) => void;
  edit: (id: string, edit: RowEdit) => void;
  retry: (id: string) => void;
  setManual: (id: string, manual: boolean) => void;
  toggle: (id: string, selected: boolean) => void;
  remove: (id: string) => void;
}

interface Props {
  row: QueueRow;
  info: RowInfo;
  locked: boolean;
  actions: RowActions;
}

/** Opens only strict Google Maps links, in a new tab without referrer. */
function MapLink({ url }: { url: string }) {
  if (!classifyMapsUrl(url.trim()).ok) return null;
  return (
    <a className="bulk-map-link" href={url.trim()} target="_blank" rel="noopener noreferrer">
      <ExternalLink aria-hidden="true" /> 在地图中核对
    </a>
  );
}

function dupNames(list: RestaurantDuplicate[]) {
  return list.map((d) => `「${d.name}」${d.active ? '' : '（已下架）'}`).join('、');
}

function statusBadge(row: QueueRow, info: RowInfo, locked: boolean): { cls: string; text: string } {
  if (locked) return { cls: 'badge-wait', text: '已提交，等待结果' };
  if (row.commit?.kind === 'error') return { cls: 'badge-bad', text: '导入失败' };
  if (info.existing.length || info.queueDuplicateOf || row.commit?.kind === 'duplicate') return { cls: 'badge-off', text: '重复，跳过' };
  if (row.status === 'queued') return { cls: 'badge-off', text: '等待识别' };
  if (row.status === 'resolving') return { cls: 'badge-wait', text: '识别中…' };
  if (row.status === 'edited') return { cls: 'badge-wait', text: '待重新识别' };
  if (row.status === 'failed' && !row.manual) return { cls: 'badge-bad', text: '识别失败' };
  if (info.importable) return { cls: 'badge-ok', text: row.manual ? '手动导入' : '可导入' };
  return { cls: 'badge-wait', text: '需要补充' };
}

function Field({
  id,
  label,
  value,
  problems,
  disabled,
  type,
  placeholder,
  listId,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  problems: RowProblem[];
  disabled: boolean;
  type?: 'url';
  placeholder?: string;
  /** A shared <datalist> of values already used (location fields). */
  listId?: string;
  onChange: (v: string) => void;
}) {
  const error = problems.map((p) => p.message).join('；');
  return (
    <div className="bulk-field">
      <label className="bulk-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type={type === 'url' ? 'url' : 'text'}
        inputMode={type === 'url' ? 'url' : undefined}
        value={value}
        placeholder={placeholder}
        list={listId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function RowMessages({ row, info }: { row: QueueRow; info: RowInfo }) {
  const notes: { tone: 'bad' | 'warn' | 'info'; text: string }[] = [];
  if (row.status === 'failed' && row.error) notes.push({ tone: 'bad', text: row.error });
  if (row.status === 'edited') notes.push({ tone: 'warn', text: '原始链接已修改，点「重新识别」读取新链接。' });
  if (info.existing.length) {
    notes.push({ tone: 'warn', text: `已有同一地点的餐厅：${dupNames(info.existing)}（${[...new Set(info.existing.flatMap((d) => d.matchedBy))].join('、')}），默认跳过。` });
  }
  if (info.queueDuplicateOf) notes.push({ tone: 'warn', text: `和第 ${info.queueDuplicateOf.index} 行是同一个地点，默认跳过。` });
  if (row.commit?.kind === 'duplicate') notes.push({ tone: 'warn', text: `${row.commit.message}：${dupNames(row.commit.duplicates)}。修改链接后可再试。` });
  if (row.commit?.kind === 'error') notes.push({ tone: 'bad', text: `服务器未导入：${row.commit.message}` });
  if (row.preview?.nameSource === 'query') notes.push({ tone: 'info', text: '店名来自搜索词，不一定是正式店名，请核对。' });
  if (row.status === 'resolved' && !row.preview?.mapUrl && !row.mapUrl.trim()) {
    notes.push({ tone: 'info', text: '识别出的链接太长，无法保存，请手动填写地图链接。' });
  }
  if (notes.length === 0) return null;
  return (
    <ul className="bulk-row-notes small">
      {notes.map((n) => (
        <li key={n.text} className={`bulk-note bulk-note-${n.tone}`}>
          {n.tone !== 'info' && <TriangleAlert aria-hidden="true" />}
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  );
}

const GEO_TEXT: Partial<Record<QueueRow['geo']['status'], string>> = {
  queued: '等待识别地区',
  pending: '正在识别地区…',
};

/** Region lookup state of a row, kept apart from the link status. */
function GeoNote({ row, locked, onRetry }: { row: QueueRow; locked: boolean; onRetry: () => void }) {
  const g = row.geo;
  const fromOsm = locationPayload(row.location).source === 'osm';
  const text = GEO_TEXT[g.status] ?? g.message;
  const retry = !locked && canRetryGeo(row) && g.status !== 'suggested' && g.status !== 'no_point' && g.status !== 'disabled';
  if (!text && !retry && !fromOsm) return null;
  return (
    <div className="bulk-geo small">
      {text && (
        <span className={g.status === 'unavailable' ? 'bulk-note-warn' : 'muted'}>
          {g.status === 'unavailable' && <TriangleAlert aria-hidden="true" />} 地区：{text}
        </span>
      )}
      {fromOsm && (
        <span className="muted">
          地区来自 <OsmAttribution />
        </span>
      )}
      {retry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          <MapPinned aria-hidden="true" /> {g.status === 'idle' ? '识别地区' : '重新识别地区'}
        </button>
      )}
    </div>
  );
}

function ImportedRow({ row, info }: { row: QueueRow; info: RowInfo }) {
  return (
    <li className="bulk-row bulk-row-imported card">
      <CircleCheck aria-hidden="true" className="bulk-imported-icon" />
      <div className="bulk-imported-text">
        <span className="muted small">第 {info.index} 行 · 已导入</span>
        <strong className="wrap-anywhere">{row.imported?.name}</strong>
      </div>
      <MapLink url={row.mapUrl} />
    </li>
  );
}

/** One queue row: editable until imported; nothing here is ever rendered as HTML. */
export const BulkRowCard = memo(function BulkRowCard({ row, info, locked, actions }: Props) {
  if (row.status === 'imported') return <ImportedRow row={row} info={info} />;
  const base = `bulk-${row.id}`;
  const badge = statusBadge(row, info, locked);
  const of = (field: RowProblem['field']) => info.problems.filter((p) => p.field === field);
  const showProblems = row.status === 'resolved' || row.manual;
  const canRetry = !locked && (isRetryable(row) || (row.status === 'resolved' && row.commit !== null));
  const selectHint = info.importable ? undefined : `${base}-status`;

  return (
    <li className={`bulk-row card ${info.selected ? 'is-selected' : ''}`} aria-labelledby={`${base}-title`}>
      <div className="bulk-row-head">
        <label className="check-row bulk-check">
          <input
            type="checkbox"
            checked={info.selected}
            disabled={!info.importable}
            aria-describedby={selectHint}
            onChange={(e) => actions.toggle(row.id, e.target.checked)}
          />
          <span id={`${base}-title`} className="bulk-row-title">
            第 {info.index} 行
          </span>
        </label>
        <span id={`${base}-status`} className={`badge ${badge.cls}`}>
          {badge.text}
        </span>
        <div className="bulk-row-actions">
          {canRetry && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.retry(row.id)}>
              <RotateCw aria-hidden="true" /> 重新识别
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`删除第 ${info.index} 行`}
            disabled={locked}
            onClick={() => actions.remove(row.id)}
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </div>

      <RowMessages row={row} info={info} />
      {row.status === 'failed' && info.canManual && (
        <label className="check-row bulk-manual small">
          <input type="checkbox" checked={row.manual} disabled={locked} onChange={(e) => actions.setManual(row.id, e.target.checked)} />
          <span>不识别了，直接用这个 Google 地图链接和我填写的店名导入</span>
        </label>
      )}

      <div className="bulk-row-fields">
        <Field
          id={`${base}-name`}
          label="店名"
          value={row.name}
          placeholder={row.status === 'resolved' ? '' : '识别后自动填写，也可以直接输入'}
          problems={showProblems ? of('name') : []}
          disabled={locked}
          onChange={(name) => actions.edit(row.id, { name })}
        />
        <Field
          id={`${base}-tags`}
          label="标签（空格分隔，可选）"
          value={row.tags}
          placeholder="川菜 约会"
          problems={of('tags')}
          disabled={locked}
          onChange={(tags) => actions.edit(row.id, { tags })}
        />
        <Field
          id={`${base}-map`}
          label="地图链接（保存到店铺）"
          type="url"
          value={row.mapUrl}
          problems={showProblems ? of('mapUrl') : []}
          disabled={locked}
          onChange={(mapUrl) => actions.edit(row.id, { mapUrl })}
        />
        <Field
          id={`${base}-source`}
          label="原始链接（识别用）"
          type="url"
          value={row.sourceUrl}
          placeholder={row.line}
          problems={[]}
          disabled={locked || row.status === 'resolving'}
          onChange={(sourceUrl) => actions.edit(row.id, { sourceUrl })}
        />
      </div>
      <div className="bulk-row-fields bulk-row-location">
        {LOCATION_FIELDS.map((f) => (
          <Field
            key={f}
            id={`${base}-${f}`}
            label={`${LOCATION_FIELD_LABEL[f]}（可选）`}
            value={row.location.values[f]}
            problems={of(f)}
            disabled={locked}
            listId={`bulk-loc-${f}`}
            onChange={(v) => actions.editLocation(row.id, f, v)}
          />
        ))}
      </div>
      <fieldset className="bulk-purposes" disabled={locked}>
        <legend className="bulk-field-label">用途</legend>
        {VENUE_PURPOSES.map((p) => (
          <label key={p} className="check-row small">
            <input
              type="checkbox"
              checked={row.purposes.includes(p)}
              aria-invalid={of('purposes').length ? true : undefined}
              onChange={() => actions.setPurposes(row.id, togglePurpose(row.purposes, p))}
            />
            <span>{PURPOSE_LABEL[p]}</span>
          </label>
        ))}
        {of('purposes').length > 0 && <span className="field-error">{of('purposes')[0]!.message}</span>}
      </fieldset>
      {row.purposes.includes('treat') && (
        <fieldset className="bulk-purposes" disabled={locked}>
          <legend className="bulk-field-label">饮品甜品类型（可选，不选为未分类）</legend>
          {TREAT_TYPES.map((t) => (
            <label key={t} className="check-row small">
              <input type="checkbox" checked={row.treatTypes.includes(t)} onChange={() => actions.setTreatTypes(row.id, toggleTreatType(row.treatTypes, t))} />
              <span>{TREAT_TYPE_LABEL[t]}</span>
            </label>
          ))}
        </fieldset>
      )}
      <GeoNote row={row} locked={locked} onRetry={() => actions.retryGeo(row.id)} />
      <MapLink url={row.mapUrl || row.sourceUrl} />
    </li>
  );
});

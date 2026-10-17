import { ListPlus, MapPinned, Pause, Play, RotateCw, Tags } from 'lucide-react';
import { useId, useState } from 'react';
import { BULK_IMPORT } from '../../../../shared/constants';
import { splitTags } from '../../../../shared/restaurant';
import type { VenuePurpose } from '../../../../shared/types';
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL } from '../../../../shared/venue';
import type { BatchFillResult, BatchTagResult, PasteResult, QueueCounts } from '../../lib/bulkQueue';
import { LOCATION_FIELD_LABEL, LOCATION_FIELDS, type LocationField } from '../../lib/venueForm';
import type { LocationOptions } from '../VenueLocationFields';

export function PasteBox({ onAdd }: { onAdd: (text: string) => PasteResult }) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length;

  const add = () => {
    const result = onAdd(text);
    if (result.ok) {
      setText('');
      setError(null);
    } else setError(result.error);
  };

  return (
    <section className="card bulk-paste" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="bulk-section-title">
        粘贴链接
      </h2>
      <label className="field-label" htmlFor={id}>
        每行一个 Google 地图链接（最多 {BULK_IMPORT.maxRows} 行）
      </label>
      <textarea
        id={id}
        className="input textarea bulk-textarea"
        rows={6}
        value={text}
        placeholder={'https://maps.app.goo.gl/…\nhttps://www.google.com/maps/place/…'}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      <p id={`${id}-hint`} className="field-hint">
        支持 maps.app.goo.gl 短链接和 google.com/maps 地点链接，带店名的分享文字也可以。没有链接的行会保留并标出原因。再次粘贴会追加到队列后面，已有的修改不受影响。
      </p>
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="bulk-paste-actions">
        <span className="muted small" aria-live="polite">
          {lines > 0 ? `${lines} 行` : ''}
        </span>
        <button type="button" className="btn btn-primary" onClick={add} disabled={lines === 0}>
          <ListPlus aria-hidden="true" /> 加入队列并识别
        </button>
      </div>
    </section>
  );
}

export type RowFilter = 'all' | 'importable' | 'attention' | 'duplicate' | 'imported';

const FILTERS: { key: RowFilter; label: string; count: (c: QueueCounts) => number }[] = [
  { key: 'all', label: '全部', count: (c) => c.total },
  { key: 'importable', label: '可导入', count: (c) => c.importable },
  { key: 'attention', label: '需处理', count: (c) => c.needsAttention },
  { key: 'duplicate', label: '重复', count: (c) => c.duplicates },
  { key: 'imported', label: '已导入', count: (c) => c.imported },
];

interface ToolbarProps {
  counts: QueueCounts;
  running: boolean;
  waitSeconds: number;
  paused: boolean;
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  onStart: () => void;
  onPause: () => void;
  onRetryAll: () => void;
  onSelectAll: (selected: boolean) => void;
  onClearImported: () => void;
  onClearAll: () => void;
  withGeo: boolean;
  onWithGeo: (on: boolean) => void;
  geoFailed: number;
  onRetryFailedGeo: () => void;
}

export function QueueToolbar(p: ToolbarProps) {
  const { counts } = p;
  return (
    <section className="card bulk-toolbar" aria-label="队列状态与操作">
      <p className="bulk-counts">
        共 <strong>{counts.total}</strong> 行 · 待识别 <strong>{counts.waiting}</strong> · 可导入 <strong>{counts.importable}</strong> · 已选{' '}
        <strong>{counts.selected}</strong>
      </p>
      {p.paused && (
        <div className="notice notice-butter small bulk-wait" role="status">
          <div>
            {p.waitSeconds > 0
              ? `识别太频繁，已暂停。请等 ${p.waitSeconds} 秒后再点「继续识别」，没识别的行都还在。`
              : '可以继续识别了。'}
          </div>
        </div>
      )}
      <div className="bulk-toolbar-actions">
        {p.running ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={p.onPause}>
            <Pause aria-hidden="true" /> 暂停识别
          </button>
        ) : (
          counts.waiting > 0 && (
            <button type="button" className="btn btn-butter btn-sm" onClick={p.onStart} disabled={p.waitSeconds > 0}>
              <Play aria-hidden="true" /> {p.waitSeconds > 0 ? `${p.waitSeconds} 秒后可继续` : '继续识别'}
            </button>
          )
        )}
        {counts.failed > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={p.onRetryAll}>
            <RotateCw aria-hidden="true" /> 重试全部失败
          </button>
        )}
        {p.geoFailed > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={p.onRetryFailedGeo} disabled={p.waitSeconds > 0}>
            <MapPinned aria-hidden="true" /> 重试失败的地区（{p.geoFailed}）
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => p.onSelectAll(true)} disabled={counts.importable === 0}>
          全选可导入
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => p.onSelectAll(false)} disabled={counts.selected === 0}>
          全不选
        </button>
        {counts.imported > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={p.onClearImported}>
            清除已导入
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={p.onClearAll} disabled={counts.total === 0}>
          清空队列
        </button>
      </div>
      <label className="check-row small">
        <input type="checkbox" checked={p.withGeo} onChange={(e) => p.onWithGeo(e.target.checked)} />
        <span>
          识别链接时同时识别地区（用链接里店铺自己的坐标查询{' '}
          <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">
            {OSM_ATTRIBUTION}
          </a>
          ，全站每秒最多 1 次，识别不到时可手动填写）
        </span>
      </label>
      <div className="chip-scroller" role="group" aria-label="筛选队列">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={p.filter === f.key} onClick={() => p.onFilter(f.key)}>
            {f.label} {f.count(counts)}
          </button>
        ))}
      </div>
    </section>
  );
}

export function BatchTags({
  selected,
  suggestions,
  onApply,
}: {
  selected: number;
  suggestions: string[];
  onApply: (raw: string) => BatchTagResult;
}) {
  const id = useId();
  const [value, setValue] = useState('');
  const [tagQuery, setTagQuery] = useState('');
  const filtered = suggestions.filter((t) => t.toLowerCase().includes(tagQuery.trim().toLowerCase()));
  const shown = filtered.slice(0, 12);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const current = splitTags(value);
  const toggle = (tag: string) => setValue((current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]).join(' '));

  const apply = () => {
    const result = onApply(value);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setValue('');
    setMessage({
      ok: true,
      text: `已添加到 ${result.applied} 行${result.skipped ? `；${result.skipped} 行的标签加起来会超过上限，没有修改` : ''}`,
    });
  };

  return (
    <section className="card bulk-tags" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="bulk-section-title">
        批量添加标签
      </h2>
      <label className="field-label" htmlFor={id}>
        给已选的 {selected} 行添加标签（空格或逗号分隔）
      </label>
      <div className="map-import-row">
        <input
          id={id}
          className="input"
          value={value}
          placeholder="川菜 约会"
          aria-describedby={message ? `${id}-msg` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
        />
        <button type="button" className="btn btn-butter" onClick={apply} disabled={selected === 0 || current.length === 0}>
          <Tags aria-hidden="true" /> 添加到已选
        </button>
      </div>
      {suggestions.length > 12 && (
        <div className="field">
          <label className="field-label small" htmlFor={`${id}-find`}>查找已有标签</label>
          <input id={`${id}-find`} className="input input-sm" type="search" value={tagQuery} placeholder="搜标签后点选"
            onChange={(e) => setTagQuery(e.target.value)} />
          <p className="field-hint">显示 {shown.length} / {filtered.length} 个标签；也可以直接在上方输入。</p>
        </div>
      )}
      {suggestions.length > 0 && shown.length === 0 && <p className="muted small">没有匹配的已有标签，可直接输入新标签。</p>}
      {shown.length > 0 && (
        <div className="chip-scroller" role="group" aria-label="已有标签，点一下加入或移出">
          {shown.map((t) => (
            <button key={t} type="button" className="chip chip-tag" aria-pressed={current.includes(t)} onClick={() => toggle(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      <p className="field-hint">只会添加到已选的待导入行，不会改动已经导入或已有的餐厅；每行的标签之后仍可单独修改。</p>
      {message && (
        <p id={`${id}-msg`} className={message.ok ? 'success-text small' : 'field-error'} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

const PURPOSE_SETS: { label: string; value: VenuePurpose[] }[] = [
  { label: '设为吃饭', value: ['meal'] },
  { label: '设为饮品甜品', value: ['treat'] },
  { label: '两样都是', value: ['meal', 'treat'] },
];

/** Batch region / purpose for the selected rows: fill empty fields by default, overwrite only on request. */
export function BatchLocation({
  selected,
  options,
  onFill,
  onPurposes,
}: {
  selected: number;
  options: LocationOptions;
  onFill: (values: Partial<Record<LocationField, string>>, mode: 'empty' | 'replace') => BatchFillResult;
  onPurposes: (purposes: VenuePurpose[]) => BatchFillResult;
}) {
  const id = useId();
  const [values, setValues] = useState<Record<LocationField, string>>({ country: '', region: '', city: '' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const hasInput = LOCATION_FIELDS.some((f) => values[f].trim());

  const fill = (mode: 'empty' | 'replace') => {
    const result = onFill(values, mode);
    setMessage(
      result.ok
        ? { ok: true, text: `已更新 ${result.applied} 行${result.unchanged ? `；${result.unchanged} 行已有内容，没有覆盖` : ''}` }
        : { ok: false, text: result.error },
    );
  };
  const purposes = (value: VenuePurpose[]) => {
    const result = onPurposes(value);
    setMessage(result.ok ? { ok: true, text: `已设置 ${result.applied} 行的用途` } : { ok: false, text: result.error });
  };

  return (
    <section className="card bulk-tags" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="bulk-section-title">
        批量填写地区和用途
      </h2>
      <p className="field-hint">作用于已选的 {selected} 行。「填入空白」只填还空着的项；要改掉已经填好的值，请用「覆盖已选行」。</p>
      <div className="location-grid">
        {LOCATION_FIELDS.map((f) => (
          <div key={f} className="bulk-field">
            <label className="bulk-field-label" htmlFor={`${id}-${f}`}>
              {LOCATION_FIELD_LABEL[f]}
            </label>
            <input
              id={`${id}-${f}`}
              className="input"
              list={options[f].length ? `bulk-loc-${f}` : undefined}
              value={values[f]}
              onChange={(e) => {
                setValues((prev) => ({ ...prev, [f]: e.target.value }));
                setMessage(null);
              }}
            />
          </div>
        ))}
      </div>
      <div className="bulk-toolbar-actions">
        <button type="button" className="btn btn-butter btn-sm" disabled={selected === 0 || !hasInput} onClick={() => fill('empty')}>
          填入空白
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={selected === 0 || !hasInput} onClick={() => fill('replace')}>
          覆盖已选行
        </button>
      </div>
      <div className="bulk-toolbar-actions" role="group" aria-label="批量设置用途">
        {PURPOSE_SETS.map((p) => (
          <button key={p.label} type="button" className="btn btn-ghost btn-sm" disabled={selected === 0} onClick={() => purposes(p.value)}>
            {p.label}
          </button>
        ))}
      </div>
      {message && (
        <p className={message.ok ? 'success-text small' : 'field-error'} role="status">
          {message.text}
        </p>
      )}
      {LOCATION_FIELDS.map((f) =>
        options[f].length ? (
          <datalist key={f} id={`bulk-loc-${f}`}>
            {options[f].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ) : null,
      )}
    </section>
  );
}

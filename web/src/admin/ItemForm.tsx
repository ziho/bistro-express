import { useState, type FormEvent } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { Dish, Restaurant } from '../../../shared/types';
import { ImageUpload } from './ImageUpload';
import { MapLinkImport } from './MapLinkImport';

export type ItemKind = 'dish' | 'restaurant';
export type CatalogItem = Dish | Restaurant;

interface FieldSpec {
  key: string;
  label: string;
  max: number;
  multiline?: boolean;
  type?: 'url';
  placeholder?: string;
  required?: boolean;
}

const FIELDS: Record<ItemKind, FieldSpec[]> = {
  dish: [
    { key: 'name', label: '菜名', max: LIMITS.name, required: true, placeholder: '比如：番茄炒蛋' },
    { key: 'category', label: '分类', max: LIMITS.shortText, placeholder: '比如：家常、汤、甜品' },
    { key: 'description', label: '介绍', max: LIMITS.description, multiline: true, placeholder: '口味、份量、小贴士…' },
    { key: 'recipeUrl', label: '做法链接', max: LIMITS.url, type: 'url', placeholder: 'https://…' },
  ],
  restaurant: [
    { key: 'name', label: '餐厅名', max: LIMITS.name, required: true, placeholder: '比如：街角小酒馆' },
    { key: 'cuisine', label: '菜系', max: LIMITS.shortText, placeholder: '比如：川菜、日料' },
    { key: 'budgetText', label: '预算', max: LIMITS.shortText, placeholder: '比如：人均 120' },
    { key: 'address', label: '地址', max: LIMITS.address },
    { key: 'mapUrl', label: '地图链接', max: LIMITS.url, type: 'url', placeholder: 'https://…' },
    { key: 'note', label: '备注', max: LIMITS.description, multiline: true, placeholder: '需要预约、营业时间提示…' },
  ],
};

export type FormValues = Record<string, string> & { tags: string };

export function toFormValues(kind: ItemKind, item: CatalogItem | null): FormValues {
  const values: FormValues = { tags: item ? item.tags.join(' ') : '' };
  for (const f of FIELDS[kind]) {
    const v = item ? (item as unknown as Record<string, unknown>)[f.key] : '';
    values[f.key] = typeof v === 'string' ? v : '';
  }
  return values;
}

export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(/[\s,，、#]+/).map((t) => t.trim()).filter(Boolean))].slice(0, LIMITS.tags);
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

interface Props {
  kind: ItemKind;
  item: CatalogItem | null;
  busy: boolean;
  serverError: string | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

export function ItemForm({ kind, item, busy, serverError, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(kind, item));
  const [imageAssetId, setImageAssetId] = useState<string | null>(item?.imageAssetId ?? null);
  const [active, setActive] = useState(item?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const nextErrors: Record<string, string> = {};
    for (const f of FIELDS[kind]) {
      const v = values[f.key]?.trim() ?? '';
      if (f.required && !v) nextErrors[f.key] = `请填写${f.label}`;
      if (f.type === 'url' && v && !isHttpUrl(v)) nextErrors[f.key] = '链接需要以 http:// 或 https:// 开头';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const payload: Record<string, unknown> = { imageAssetId, active, tags: parseTags(values.tags) };
    for (const f of FIELDS[kind]) {
      const v = values[f.key]?.trim() ?? '';
      payload[f.key] = f.type === 'url' ? v || null : v;
    }
    onSubmit(payload);
  };

  return (
    <form id="item-form" className="item-form" onSubmit={submit} noValidate>
      {kind === 'restaurant' && !item && (
        <MapLinkImport
          current={{ name: values.name ?? '', mapUrl: values.mapUrl ?? '' }}
          onApply={(updates) => setValues((prev) => ({ ...prev, ...updates }))}
        />
      )}
      <ImageUpload assetId={imageAssetId} onChange={setImageAssetId} />
      {FIELDS[kind].map((f) => {
        const id = `item-${f.key}`;
        const common = {
          id,
          className: `input ${f.multiline ? 'textarea' : ''}`,
          maxLength: f.max,
          placeholder: f.placeholder,
          value: values[f.key] ?? '',
          'aria-invalid': errors[f.key] ? true : undefined,
          'aria-describedby': errors[f.key] ? `${id}-err` : undefined,
          onChange: (e: { target: { value: string } }) => setValues((prev) => ({ ...prev, [f.key]: e.target.value })),
        };
        return (
          <div className="field" key={f.key}>
            <label className="field-label" htmlFor={id}>
              {f.label}
              {f.required && <span aria-hidden="true"> *</span>}
            </label>
            {f.multiline ? <textarea rows={3} {...common} /> : <input type={f.type === 'url' ? 'url' : 'text'} inputMode={f.type === 'url' ? 'url' : undefined} {...common} />}
            {errors[f.key] && (
              <p id={`${id}-err`} className="field-error">
                {errors[f.key]}
              </p>
            )}
          </div>
        );
      })}
      <div className="field">
        <label className="field-label" htmlFor="item-tags">
          标签 <span className="muted small">（空格或逗号分隔）</span>
        </label>
        <input
          id="item-tags"
          className="input"
          value={values.tags}
          placeholder="快手 下饭 约会"
          onChange={(e) => setValues((prev) => ({ ...prev, tags: e.target.value }))}
        />
      </div>
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
        <span>{active ? '上架中（点餐时可选）' : '已下架（点餐时隐藏）'}</span>
      </label>
      {serverError && (
        <p className="error-text" role="alert">
          {serverError}
        </p>
      )}
    </form>
  );
}

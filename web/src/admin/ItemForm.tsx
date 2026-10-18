import { Fragment, useState, type FormEvent } from 'react';
import { LIMITS } from '../../../shared/constants';
import { splitTags } from '../../../shared/restaurant';
import type { Dish, GeoOutcome, Restaurant, VenuePurpose } from '../../../shared/types';
import {
  collectDishDetails,
  collectIngredients,
  toDishFormState,
  type DishFieldErrors,
  type DishFormState,
  type IngredientRow,
  type IngredientRowError,
} from '../lib/dishForm';
import { collectLinks, toLinkRows, type LinkRow, type LinkRowError } from '../lib/linkRows';
import { locationPayload, locationProblems, toLocationForm, type LocationFormState, type LocationProblems } from '../lib/venueForm';
import { VenueLocationFields, type LocationOptions } from './VenueLocationFields';
import { DishDetailsFields } from './dish/DishDetailsFields';
import { SectionField } from './dish/SectionField';
import { ImageUpload } from './ImageUpload';
import { MapLinkImport } from './MapLinkImport';
import { RestaurantLinksEditor } from './RestaurantLinksEditor';
import { TagField } from './TagField';
import { VenueTagField } from './VenueTagField';
import { VenueEntryField } from './VenueEntryField';
import { FormSection } from './FormSection';
import { formatLocation } from '../../../shared/venue';

export type ItemKind = 'dish' | 'restaurant';
export type CatalogItem = Dish | Restaurant;

interface FieldSpec {
  key: string;
  label: string;
  max: number;
  /** Textarea rows; omitted = single-line input. */
  rows?: number;
  /** 'url' = http(s) link. */
  type?: 'url';
  placeholder?: string;
  hint?: string;
  required?: boolean;
}

const FIELDS: Record<ItemKind, FieldSpec[]> = {
  dish: [
    { key: 'name', label: '菜名', max: LIMITS.name, required: true, placeholder: '比如：番茄炒蛋' },
    { key: 'description', label: '介绍', max: LIMITS.description, rows: 3, placeholder: '口味、份量、小贴士…' },
    { key: 'recipeUrl', label: '做法链接', max: LIMITS.url, type: 'url', placeholder: 'https://…' },
  ],
  restaurant: [
    { key: 'name', label: '店名', max: LIMITS.name, required: true, placeholder: '比如：街角小酒馆、楼下奶茶店' },
    {
      key: 'review',
      label: '一句话点评',
      max: LIMITS.review,
      rows: 2,
      placeholder: '比如：汤底很鲜，适合冬天两个人慢慢吃',
      hint: '会显示在选餐厅的卡片上，一句话说清这家店的特点。',
    },
    { key: 'budgetText', label: '预算', max: LIMITS.shortText, placeholder: '比如：人均 120' },
    { key: 'address', label: '地址', max: LIMITS.address },
    { key: 'mapUrl', label: '地图链接', max: LIMITS.url, type: 'url', placeholder: 'https://…' },
    { key: 'note', label: '备注', max: LIMITS.description, rows: 3, placeholder: '需要预约、营业时间提示…' },
  ],
};

/** The tag field is rendered right after this field. */
const TAGS_AFTER: Record<ItemKind, string> = { dish: 'recipeUrl', restaurant: 'review' };
/** The dish's menu sections are rendered right after this field. */
const SECTIONS_AFTER = 'name';

const asDish = (item: CatalogItem | null): Dish | null => (item && !('review' in item) ? item : null);

/** The optional details start open when the dish already has any of them, so nothing saved is hidden. */
const hasSavedDetails = (d: Dish | null) =>
  Boolean(d && (d.ingredients.length || d.totalMinutes !== null || d.activeMinutes !== null || d.servingText || d.shoppingNote));

export type FormValues = Record<string, string> & { tags: string };

export function toFormValues(kind: ItemKind, item: CatalogItem | null): FormValues {
  const values: FormValues = { tags: item ? item.tags.join(' ') : '' };
  for (const f of FIELDS[kind]) {
    const v = item ? (item as unknown as Record<string, unknown>)[f.key] : '';
    values[f.key] = typeof v === 'string' ? v : '';
  }
  return values;
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function fieldError(f: FieldSpec, v: string): string | null {
  if (f.required && !v) return `请填写${f.label}`;
  if (f.type === 'url' && v && !isHttpUrl(v)) return '链接需要以 http:// 或 https:// 开头';
  return null;
}

function tagsError(tags: string[], max: number): string | null {
  if (tags.length > max) return `最多 ${max} 个标签，现在有 ${tags.length} 个，请删掉一些`;
  const long = tags.find((t) => t.length > LIMITS.tag);
  return long ? `标签「${long}」超过 ${LIMITS.tag} 个字，请缩短或拆开` : null;
}

interface Props {
  kind: ItemKind;
  item: CatalogItem | null;
  busy: boolean;
  serverError: string | null;
  /** Tags already used in this catalog, offered for reuse. */
  tagSuggestions?: string[];
  /** Menu sections already used by dishes (incl. old categories), offered for reuse. */
  sectionSuggestions?: string[];
  /** Countries / regions / cities already used by venues, offered for reuse (no global dictionary). */
  locationOptions?: LocationOptions;
  onSubmit: (payload: Record<string, unknown>) => void;
}

const NO_OPTIONS: LocationOptions = { country: [], region: [], city: [] };

export function ItemForm({ kind, item, busy, serverError, tagSuggestions = [], sectionSuggestions = [], locationOptions = NO_OPTIONS, onSubmit }: Props) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(kind, item));
  const [imageAssetId, setImageAssetId] = useState<string | null>(item?.imageAssetId ?? null);
  const [active, setActive] = useState(item?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [linkRows, setLinkRows] = useState<LinkRow[]>(() => toLinkRows(item && 'links' in item ? item.links : []));
  const [linkErrors, setLinkErrors] = useState<Record<string, LinkRowError>>({});
  const [dishState, setDishState] = useState<DishFormState>(() => toDishFormState(asDish(item)));
  const [dishErrors, setDishErrors] = useState<DishFieldErrors>({});
  const [ingredientErrors, setIngredientErrors] = useState<Record<string, IngredientRowError>>({});
  const [detailsOpen, setDetailsOpen] = useState(() => hasSavedDetails(asDish(item)));
  const venue = item && 'review' in item ? item : null;
  const [venueTags, setVenueTags] = useState<string[]>(() => venue?.tags ?? []);
  const [location, setLocation] = useState<LocationFormState>(() => toLocationForm(venue?.location));
  const [locationErrors, setLocationErrors] = useState<LocationProblems>({});
  const [purposes, setPurposes] = useState<VenuePurpose[]>(() => venue?.purposes ?? ['meal']);
  const [purposeError, setPurposeError] = useState<string | undefined>();
  const [pendingTag, setPendingTag] = useState('');
  const [groups, setGroups] = useState({ location: false, links: false, details: false, photo: false });
  const toggleGroup = (key: keyof typeof groups) => setGroups((previous) => ({ ...previous, [key]: !previous[key] }));
  const [geoIncoming, setGeoIncoming] = useState<{ outcome: GeoOutcome; at: number } | null>(null);
  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const patchDish = (patch: Partial<DishFormState>) => {
    setDishState((prev) => ({ ...prev, ...patch }));
    setDishErrors((prev) => {
      const next = { ...prev };
      for (const key of ['sections', 'totalMinutes', 'activeMinutes', 'servingText', 'shoppingNote'] as const) {
        if (key in patch) delete next[key];
      }
      if ('totalMinutes' in patch || 'activeMinutes' in patch) {
        delete next.totalMinutes;
        delete next.activeMinutes;
      }
      return next;
    });
  };

  const updateIngredientRows = (rows: IngredientRow[]) => {
    patchDish({ ingredientRows: rows });
    // Recheck rows that already show an error as they are edited; don't flag new blank rows.
    setIngredientErrors((previous) => {
      const current = collectIngredients(rows).errors;
      return Object.fromEntries(Object.keys(previous).flatMap((key) => (current[key] ? [[key, current[key]]] : [])));
    });
  };

  const updateLinkRows = (rows: LinkRow[]) => {
    setLinkRows(rows);
    // Recheck rows that already show an error as they are edited; don't flag new blank rows.
    setLinkErrors((previous) => {
      const current = collectLinks(rows).errors;
      const remaining: Record<string, LinkRowError> = {};
      for (const key of Object.keys(previous)) {
        const error = current[key];
        if (error) remaining[key] = error;
      }
      return remaining;
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const nextErrors: Record<string, string> = {};
    for (const f of FIELDS[kind]) {
      const error = fieldError(f, values[f.key]?.trim() ?? '');
      if (error) nextErrors[f.key] = error;
    }
    const tags = kind === 'restaurant' ? [...new Set([...venueTags, ...splitTags(pendingTag)])] : splitTags(values.tags);
    const tagError = tagsError(tags, kind === 'restaurant' ? LIMITS.restaurantTags : LIMITS.tags);
    if (tagError) nextErrors.tags = tagError;
    const links = kind === 'restaurant' ? collectLinks(linkRows) : null;
    const dish = kind === 'dish' ? collectDishDetails(dishState) : null;
    const locErrors = kind === 'restaurant' ? locationProblems(location) : {};
    const purposeProblem = kind === 'restaurant' && purposes.length === 0 ? '请至少选择一个前台入口' : undefined;
    setLocationErrors(locErrors);
    setPurposeError(purposeProblem);
    if (kind === 'restaurant') setGroups((g) => ({ ...g,
      location: g.location || Boolean(nextErrors.mapUrl || nextErrors.address || Object.keys(locErrors).length),
      links: g.links || Boolean(links && Object.keys(links.errors).length),
      details: g.details || Boolean(nextErrors.budgetText || nextErrors.note),
    }));
    setErrors(nextErrors);
    setLinkErrors(links?.errors ?? {});
    setDishErrors(dish?.errors ?? {});
    setIngredientErrors(dish?.ingredientErrors ?? {});
    const detailErrors = dish ? Object.keys({ ...dish.errors, ...dish.ingredientErrors }).filter((k) => k !== 'sections') : [];
    if (detailErrors.length) setDetailsOpen(true);
    if (
      Object.keys(nextErrors).length ||
      Object.keys(locErrors).length ||
      purposeProblem ||
      (links && Object.keys(links.errors).length) ||
      (dish && (detailErrors.length || dish.errors.sections))
    ) {
      // Wait for inline errors and any expanded details to render, then reveal the first field.
      requestAnimationFrame(() => {
        document.getElementById('item-form')?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    const payload: Record<string, unknown> = { imageAssetId, active, tags };
    for (const f of FIELDS[kind]) {
      const v = values[f.key]?.trim() ?? '';
      payload[f.key] = f.type ? v || null : v;
    }
    if (links) payload.links = links.links;
    if (kind === 'restaurant') {
      // Sent in full, so a cleared field really clears it and 用途 is never left to a default.
      payload.location = locationPayload(location);
      payload.purposes = purposes;
    }
    // Every detail field is sent, so a cleared value really clears what was stored.
    onSubmit(dish ? { ...payload, ...dish.details } : payload);
  };

  const tagField = kind === 'restaurant' ? (
    <VenueTagField value={venueTags} draft={pendingTag} onDraft={setPendingTag} error={errors.tags}
      suggestions={tagSuggestions} onChange={(v) => { setVenueTags(v); setErrors((e) => ({ ...e, tags: '' })); }} />
  ) : (
    <TagField
      kind={kind}
      value={values.tags}
      error={errors.tags}
      suggestions={tagSuggestions}
      onChange={(v) => setValue('tags', v)}
    />
  );

  return (
    <form id="item-form" className="item-form" onSubmit={submit} noValidate>
      {kind === 'restaurant' && !item && (
        <MapLinkImport
          current={{ name: values.name ?? '', mapUrl: values.mapUrl ?? '' }}
          onApply={(updates) => setValues((prev) => ({ ...prev, ...updates }))}
          onGeo={(outcome) => { setGeoIncoming({ outcome, at: Date.now() }); setGroups((g) => ({ ...g, location: true })); }}
        />
      )}
      {kind === 'restaurant' ? (
        <>
          <p className="field-hint form-intro">先填常用资料，其他内容随时补充。</p>
          <TextField spec={FIELDS.restaurant[0]!} value={values.name ?? ''} error={errors.name} onChange={(v) => setValue('name', v)} />
          <VenueEntryField value={purposes} onChange={(next) => { setPurposes(next); setPurposeError(undefined); }} error={purposeError} />
          {tagField}
          <TextField spec={FIELDS.restaurant[1]!} value={values.review ?? ''} error={errors.review} onChange={(v) => setValue('review', v)} />
          <FormSection title="位置与地图" summary={[formatLocation({ ...location.values, countryCode: '', source: '' }), values.mapUrl ? '已有地图链接' : '未填地图链接'].filter(Boolean).join(' · ')} open={groups.location} onToggle={() => toggleGroup('location')}>
            {['mapUrl', 'address'].map((key) => <TextField key={key} spec={FIELDS.restaurant.find((f) => f.key === key)!} value={values[key] ?? ''} error={errors[key]} onChange={(v) => setValue(key, v)} />)}
            <VenueLocationFields state={location} onChange={(next) => { setLocation(next); setLocationErrors({}); }}
              mapUrl={values.mapUrl ?? ''} incoming={geoIncoming} options={locationOptions} problems={locationErrors} />
          </FormSection>
          <FormSection title="菜单与相关链接" summary={linkRows.some((r) => r.url.trim()) ? `已填 ${linkRows.filter((r) => r.url.trim()).length} 个链接` : '菜单、官网等，可调整顺序'} open={groups.links} onToggle={() => toggleGroup('links')}>
            <RestaurantLinksEditor rows={linkRows} errors={linkErrors} onChange={updateLinkRows} />
          </FormSection>
          <FormSection title="预算与备注" summary={[values.budgetText, values.note ? '已有备注' : ''].filter(Boolean).join(' · ') || '人均预算、预约提醒等'} open={groups.details} onToggle={() => toggleGroup('details')}>
            {['budgetText', 'note'].map((key) => <TextField key={key} spec={FIELDS.restaurant.find((f) => f.key === key)!} value={values[key] ?? ''} error={errors[key]} onChange={(v) => setValue(key, v)} />)}
          </FormSection>
          <FormSection title="店铺照片" summary={imageAssetId ? '已上传照片' : '可选，不放照片也能展示'} open={groups.photo} onToggle={() => toggleGroup('photo')}>
            <ImageUpload assetId={imageAssetId} onChange={setImageAssetId} />
          </FormSection>
        </>
      ) : (
        <>
          <ImageUpload assetId={imageAssetId} onChange={setImageAssetId} />
          {FIELDS.dish.map((f) => <Fragment key={f.key}>
            <TextField spec={f} value={values[f.key] ?? ''} error={errors[f.key]} onChange={(v) => setValue(f.key, v)} />
            {f.key === SECTIONS_AFTER && <SectionField value={dishState.sections} existing={sectionSuggestions} error={dishErrors.sections} onChange={(sections) => patchDish({ sections })} />}
            {f.key === TAGS_AFTER.dish && <>{tagField}<DishDetailsFields state={dishState} errors={dishErrors} ingredientErrors={ingredientErrors} open={detailsOpen} onToggle={setDetailsOpen} onChange={patchDish} onIngredientsChange={updateIngredientRows} /></>}
          </Fragment>)}
        </>
      )}
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

function TextField({ spec: f, value, error, onChange }: { spec: FieldSpec; value: string; error?: string; onChange: (v: string) => void }) {
  const id = `item-${f.key}`;
  const describedBy = [f.hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ');
  const isLink = f.type !== undefined;
  const common = {
    id,
    className: `input ${f.rows ? 'textarea' : ''}`,
    maxLength: f.max,
    placeholder: f.placeholder,
    value,
    'aria-invalid': error ? true : undefined,
    'aria-required': f.required ? true : undefined,
    'aria-describedby': describedBy || undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {f.label}
        {f.required && <span aria-hidden="true"> *</span>}
      </label>
      {f.rows ? (
        <textarea rows={f.rows} {...common} />
      ) : (
        <input type={isLink ? 'url' : 'text'} inputMode={isLink ? 'url' : undefined} {...common} />
      )}
      {f.hint && (
        <p id={`${id}-hint`} className="field-hint">
          {f.hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

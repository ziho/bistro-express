import { ClipboardList, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { splitShoppingByPantry } from '../../../shared/pantry';
import { deriveShopping, type ShoppingDishInput, type ShoppingGroup } from '../../../shared/shopping';
import type { ShoppingDishNote, ShoppingSource } from '../../../shared/types';

/**
 * Text-first pieces shared by the editor's read-only preview and a saved meal's checklist. Only
 * recorded details are shown: no placeholder quantity, no stock or availability guess.
 */

type ManualSource = Extract<ShoppingSource, { kind: 'manual' }>;

interface SourcesProps {
  /** Group display name; a source written differently (e.g. other English case) shows its own spelling. */
  name: string;
  sources: readonly ShoppingSource[];
  /** Edit/delete controls for a manual source (saved, writable lists only). */
  renderManualActions?: (source: ManualSource) => ReactNode;
}

export function ShoppingSources({ name, sources, renderManualActions }: SourcesProps) {
  return (
    <ul className="shop-sources">
      {sources.map((s, index) => {
        const note = s.kind === 'dish' ? s.purchaseNote : s.note;
        const origin = s.kind === 'dish' ? s.dishName : '手动补充';
        return (
          <li key={s.kind === 'dish' ? `d-${index}-${s.dishId}` : `m-${s.manualId}`} className={`shop-source shop-source-${s.kind}`}>
            <div className="shop-source-main">
              <p className="shop-source-line">
                {s.quantity && <span className="shop-qty">{s.quantity}</span>}
                <span className={s.kind === 'manual' ? 'shop-origin shop-origin-manual' : 'shop-origin'}>
                  <span className="sr-only">{s.quantity ? '，' : ''}来源：</span>
                  {origin}
                </span>
                {s.name !== name && <span className="shop-spelling">（写作 {s.name}）</span>}
              </p>
              {note && (
                <p className="shop-source-note">
                  {s.kind === 'dish' ? '采购：' : '备注：'}
                  {note}
                </p>
              )}
            </div>
            {s.kind === 'manual' && renderManualActions?.(s)}
          </li>
        );
      })}
    </ul>
  );
}

/** Dishes without recorded main ingredients contribute nothing to the list; say so by name. */
export function MissingIngredientsNotice({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="notice notice-sky small shop-missing">
      <Info aria-hidden="true" />
      <div>
        <p className="shop-missing-title">这些菜还没有记录主料，清单里没有它们的食材：</p>
        <p className="wrap-anywhere">{names.join('、')}</p>
      </div>
    </div>
  );
}

/** Each dish's overall purchase reminder, with the dish name; never turned into a status. */
export function DishShoppingNotes({ notes, heading: H = 'h3' }: { notes: readonly ShoppingDishNote[]; heading?: 'h3' | 'h4' }) {
  if (notes.length === 0) return null;
  return (
    <div className="shop-dish-notes">
      <H className="shop-subtitle">整道菜的采购提醒</H>
      <ul>
        {notes.map((n) => (
          <li key={n.dishId}>
            <strong>{n.dishName}</strong>
            <span className="pre-wrap">{n.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewGroups({ groups, label }: { groups: readonly ShoppingGroup[]; label?: string }) {
  return (
    <ul className="shop-list" aria-label={label}>
      {groups.map((g) => (
        <li key={g.key} className="shop-item">
          <h3 className="shop-item-name">{g.name}</h3>
          <ShoppingSources name={g.name} sources={g.sources} />
        </li>
      ))}
    </ul>
  );
}

interface PreviewProps {
  dishes: readonly ShoppingDishInput[];
  unavailable: number;
  /** Match keys of the ingredients remembered on this device; empty = no split. */
  have: ReadonlySet<string>;
}

/**
 * Read-only checklist derived from the selected dishes before the meal is saved. With remembered
 * ingredients it is split into 家里可能已有 / 还需采购 — a hint only: groups, sources and
 * quantities stay exactly as derived and no status is written anywhere.
 */
export function ShoppingPreview({ dishes, unavailable, have }: PreviewProps) {
  const { groups, dishNotes, dishesWithoutIngredients } = deriveShopping(dishes);
  const split = have.size > 0 ? splitShoppingByPantry(groups, have) : null;
  return (
    <div className="shop-preview">
      <p className="notice notice-butter small shop-preview-hint">
        <ClipboardList aria-hidden="true" />
        <span>保存这一餐后，可标记状态和补充采购项。这里只是按已选的菜预览。</span>
      </p>
      <MissingIngredientsNotice names={dishesWithoutIngredients} />
      {unavailable > 0 && <p className="muted small">有 {unavailable} 道已下架的菜没有算在预览里。</p>}
      {groups.length === 0 ? (
        <p className="muted shop-empty">已选的菜还没有记录主料，暂时没有可列出的食材。</p>
      ) : split ? (
        <>
          <p className="muted small">
            共 {groups.length} 样。按这台设备记下的现有食材分开显示，只比较名称、不核对数量，也不会改变任何状态。
          </p>
          <section className="shop-preview-part" aria-labelledby="preview-need">
            <h3 id="preview-need" className="shop-subtitle">
              还需采购（{split.need.length}）
            </h3>
            {split.need.length ? <PreviewGroups groups={split.need} label="还需采购" /> : <p className="muted small">看起来都不用买。</p>}
          </section>
          <section className="shop-preview-part shop-preview-have" aria-labelledby="preview-have">
            <h3 id="preview-have" className="shop-subtitle">
              家里可能已有（{split.maybeHave.length}）
            </h3>
            {split.maybeHave.length ? (
              <>
                <p className="muted small">请看看数量够不够这一餐用。</p>
                <PreviewGroups groups={split.maybeHave} label="家里可能已有" />
              </>
            ) : (
              <p className="muted small">记下的现有食材里没有这些菜的主料。</p>
            )}
          </section>
        </>
      ) : (
        <>
          <p className="muted small">共 {groups.length} 样（同名食材合在一起，每道菜的用量分别列出，不换算、不相加）。</p>
          <PreviewGroups groups={groups} />
        </>
      )}
      <DishShoppingNotes notes={dishNotes} />
    </div>
  );
}

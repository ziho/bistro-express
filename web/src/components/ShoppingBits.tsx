import { ClipboardList, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { deriveShopping, type ShoppingDishInput } from '../../../shared/shopping';
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

/** Read-only checklist derived from the selected dishes before the meal is saved. */
export function ShoppingPreview({ dishes, unavailable }: { dishes: readonly ShoppingDishInput[]; unavailable: number }) {
  const { groups, dishNotes, dishesWithoutIngredients } = deriveShopping(dishes);
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
      ) : (
        <>
          <p className="muted small">共 {groups.length} 样（同名食材合在一起，每道菜的用量分别列出，不换算、不相加）。</p>
          <ul className="shop-list">
            {groups.map((g) => (
              <li key={g.key} className="shop-item">
                <h3 className="shop-item-name">{g.name}</h3>
                <ShoppingSources name={g.name} sources={g.sources} />
              </li>
            ))}
          </ul>
        </>
      )}
      <DishShoppingNotes notes={dishNotes} />
    </div>
  );
}

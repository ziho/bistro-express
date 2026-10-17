import { ExternalLink } from 'lucide-react';
import { dishFactsText, dishIngredientLine, formatMinutes, safeRecipeUrl } from '../../../shared/dish';
import type { DishSnapshot } from '../../../shared/types';
import { ItemImage } from './ItemImage';
import { TagList } from './RestaurantBits';

/** Fields shared by a catalog dish and its plan snapshot. */
export type DishView = Pick<
  DishSnapshot,
  | 'name'
  | 'imageAssetId'
  | 'sections'
  | 'tags'
  | 'description'
  | 'recipeUrl'
  | 'ingredients'
  | 'totalMinutes'
  | 'activeMinutes'
  | 'servingText'
  | 'shoppingNote'
>;

/** Read-only menu section labels (菜单分区). Renders nothing without sections. */
export function SectionLabels({ sections, as = 'ul' }: { sections: string[]; as?: 'ul' | 'span' }) {
  if (sections.length === 0) return null;
  if (as === 'span') {
    // Phrasing-only variant for use inside a <button>.
    return (
      <span className="section-labels">
        <span className="sr-only">菜单分区：</span>
        {sections.map((s) => (
          <span key={s} className="section-label">
            {s}
          </span>
        ))}
      </span>
    );
  }
  return (
    <ul className="section-labels" aria-label="菜单分区">
      {sections.map((s) => (
        <li key={s} className="section-label">
          {s}
        </li>
      ))}
    </ul>
  );
}

/** One-line text summary for cards and lists: main ingredients, then time and serving. */
export function dishSummaryLines(d: DishView): { ingredients: string; facts: string } {
  const line = dishIngredientLine(d.ingredients);
  return { ingredients: line ? `主料：${line}` : '', facts: dishFactsText(d) };
}

type Heading = 'h3' | 'h4';

interface DishInfoProps {
  dish: DishView;
  heading?: Heading;
  /** Inside a row that already shows the photo and sections (saved plan): omit them here. */
  compact?: boolean;
}

/**
 * Everything recorded about a dish, for the picker's detail sheet and a saved plan. Only filled
 * fields are shown; the photo only when there is one (no placeholder).
 */
export function DishInfo({ dish: d, heading: H = 'h3', compact = false }: DishInfoProps) {
  const recipe = safeRecipeUrl(d.recipeUrl);
  const hasTimes = d.totalMinutes !== null || d.activeMinutes !== null || d.servingText;
  return (
    <div className="detail dish-info">
      {!compact && d.imageAssetId && (
        <ItemImage assetId={d.imageAssetId} name={d.name} variant="full" className="detail-image detail-photo" />
      )}
      {!compact && <SectionLabels sections={d.sections} />}
      <TagList tags={d.tags} />
      {d.description && <p className="detail-desc">{d.description}</p>}
      {hasTimes && (
        <dl className="detail-facts detail-facts-wide">
          {d.totalMinutes !== null && (
            <div>
              <dt>总耗时</dt>
              <dd>{formatMinutes(d.totalMinutes)}</dd>
            </div>
          )}
          {d.activeMinutes !== null && (
            <div>
              <dt>动手时间</dt>
              <dd>{formatMinutes(d.activeMinutes)}</dd>
            </div>
          )}
          {d.servingText && (
            <div>
              <dt>份量</dt>
              <dd>{d.servingText}</dd>
            </div>
          )}
        </dl>
      )}
      {d.ingredients.length > 0 && (
        <div>
          <H className="detail-subtitle">主料</H>
          <ul className="dish-ingredients">
            {d.ingredients.map((i, index) => (
              <li key={`${index}-${i.name}`}>
                <span className="dish-ingredient-head">
                  <span className="dish-ingredient-name">{i.name}</span>
                  {i.quantity && <span className="dish-ingredient-qty">{i.quantity}</span>}
                </span>
                {i.purchaseNote && <span className="dish-ingredient-note">采购：{i.purchaseNote}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.shoppingNote && (
        <div>
          <H className="detail-subtitle">采购提醒</H>
          <p className="detail-desc">{d.shoppingNote}</p>
        </div>
      )}
      {recipe && (
        <div className="link-actions">
          <a className="btn btn-ghost btn-sm" href={recipe} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            查看做法
            <span className="sr-only">（{d.name}，新窗口打开）</span>
          </a>
        </div>
      )}
    </div>
  );
}

import { Check, CircleDashed, HardDriveDownload } from 'lucide-react';
import type { PantryMatch } from '../../../shared/pantry';
import type { PantryStorageState } from '../lib/pantryStore';
import { pantryMatchLabel } from '../lib/pantryFinder';

/** What the finder can and cannot tell; shown wherever a match result is shown. */
export const PANTRY_CAVEAT = '只比较记录的主料名称，不核对数量；记录的主料可能不完整。';

/** Phrasing-only summary for inside a dish card button (no nested interactive content). */
export function PantryMatchLine({ match }: { match: PantryMatch }) {
  const names = (kinds: PantryMatch['matched']) => kinds.map((k) => k.name).join('、');
  return (
    <span className="pantry-line">
      <span className={`pantry-state pantry-state-${match.state}`}>{pantryMatchLabel(match)}</span>
      {match.state === 'unknown' ? (
        <span className="pantry-names">没有记录主料</span>
      ) : (
        <>
          {match.matched.length > 0 && <span className="pantry-names">已有：{names(match.matched)}</span>}
          {match.missing.length > 0 && <span className="pantry-names pantry-names-missing">还缺：{names(match.missing)}</span>}
        </>
      )}
    </span>
  );
}

/** Per-ingredient comparison in the dish detail sheet, with every recorded quantity and note. */
export function PantryMatchDetail({ match }: { match: PantryMatch }) {
  const kinds = [...match.matched.map((k) => ({ ...k, have: true })), ...match.missing.map((k) => ({ ...k, have: false }))];
  return (
    <section className="pantry-detail" aria-label="和现有食材对比">
      <p className="pantry-detail-head">
        <span className={`pantry-state pantry-state-${match.state}`}>{pantryMatchLabel(match)}</span>
        <span className="muted small">{PANTRY_CAVEAT}</span>
      </p>
      {match.state === 'unknown' ? (
        <p className="muted small">这道菜没有记录主料，暂时无法判断。</p>
      ) : (
        <ul className="pantry-kinds">
          {kinds.map((k) => (
            <li key={k.key} className={k.have ? 'is-have' : 'is-missing'}>
              <span className="pantry-kind-mark" aria-hidden="true">
                {k.have ? <Check /> : <CircleDashed />}
              </span>
              <span className="pantry-kind-text">
                <span className="pantry-kind-name">
                  {k.name}
                  <span className="sr-only">{k.have ? '：现有食材里有' : '：现有食材里没有'}</span>
                </span>
                {k.rows.map((row, index) => {
                  // Only what was recorded: no placeholder for a missing quantity or note.
                  const text = [row.name !== k.name ? `写作 ${row.name}` : '', row.quantity, row.purchaseNote && `采购：${row.purchaseNote}`]
                    .filter(Boolean)
                    .join(' · ');
                  return text ? (
                    <span key={index} className="pantry-kind-row">
                      {text}
                    </span>
                  ) : null;
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Explains a storage problem; the list keeps working in memory either way. */
export function PantryStorageNotice({ storage, onClear }: { storage: PantryStorageState; onClear?: () => void }) {
  if (storage === 'ok') return null;
  return (
    <div className="notice notice-butter small pantry-storage" role="status">
      <HardDriveDownload aria-hidden="true" />
      <div>
        {storage === 'blocked' ? (
          <p>这台设备现在不能保存现有食材（可能是无痕模式或存储已满）。清单仍可使用，但关闭页面后不会保留。</p>
        ) : (
          <>
            <p>本机保存的现有食材无法读取，先按空清单显示。添加或清空后会覆盖这份数据。</p>
            {onClear && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
                清除无法读取的数据
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

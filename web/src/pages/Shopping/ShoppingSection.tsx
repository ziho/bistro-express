import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, RefreshCw, Refrigerator, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SHOPPING_LIMITS } from '../../../../shared/constants';
import { pantryCandidates } from '../../../../shared/pantry';
import { SHOPPING_STATUS_LABELS, shoppingKey } from '../../../../shared/shopping';
import type { Plan, ShoppingItem, ShoppingList, ShoppingManualItem, ShoppingStatus } from '../../../../shared/types';
import { keys, useShoppingList } from '../../api/queries';
import { DishShoppingNotes, MissingIngredientsNotice } from '../../components/ShoppingBits';
import { Sheet } from '../../components/Sheet';
import { useOnline } from '../../lib/hooks';
import { usePantry } from '../../lib/pantryStore';
import { partitionShopping } from '../../lib/shopping';
import { ManualItemForm, type ManualSubmitResult, type ManualValues } from './ManualItemForm';
import { PantryHaveSheet, type HaveSession, type ShoppingBase } from './PantryHaveSheet';
import { itemSelector, ShoppingItemRow } from './ShoppingItemRow';
import { useShoppingWriter, type ShoppingWriteResult } from './useShoppingWriter';

interface Problem {
  message: string;
  retry: (() => void) | null;
}

const LOCK_TEXT = {
  cancelled: '这一餐已取消，采购清单只能查看。',
  past: '这一餐已经过去，采购清单只能查看。',
  restaurant: '去餐厅的计划没有采购清单。',
} as const;

const isVisible = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && !el.closest('details:not([open])');

/** A saved home meal's shared checklist: pending first, have/bought collapsible, manual additions. */
export function ShoppingSection({ plan }: { plan: Plan }) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const query = useShoppingList(plan.id, plan.mode === 'home');
  const list = query.data;
  const { run, busy } = useShoppingWriter(plan.id, list);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Keep the meal and its checklist on the same version (another device may have edited either).
  useEffect(() => {
    if (!list) return;
    if (list.planVersion > plan.version) void queryClient.invalidateQueries({ queryKey: keys.plan(plan.id) });
    else if (list.planVersion < plan.version || (plan.status === 'cancelled' && list.lockReason !== 'cancelled')) {
      void queryClient.invalidateQueries({ queryKey: keys.shopping(plan.id) });
    }
  }, [list, plan.id, plan.version, plan.status, queryClient]);

  if (plan.mode !== 'home') return null;

  const focusFirst = (selectors: string[]) =>
    window.requestAnimationFrame(() => {
      const root = sectionRef.current;
      for (const selector of selectors) {
        const el = root?.querySelector(selector) ?? null;
        if (isVisible(el)) return el.focus();
      }
      headingRef.current?.focus();
    });

  const fail = (message: string, retry: (() => void) | null) => {
    setProblem({ message, retry });
    setAnnouncement('');
  };

  const succeed = (message: string) => {
    setProblem(null);
    setAnnouncement(message);
  };

  const basePath = `/plans/${plan.id}/shopping`;

  const changeStatus = async (item: ShoppingItem, status: ShoppingStatus, from: readonly ShoppingItem[]) => {
    const index = from.findIndex((i) => i.key === item.key);
    const neighbours = [...from.slice(index + 1), ...from.slice(0, Math.max(index, 0)).reverse()];
    const result = await run({ method: 'PUT', path: `${basePath}/status`, payload: { key: item.key, status } }, `status:${item.key}`);
    const label = SHOPPING_STATUS_LABELS[status];
    if (!result.ok) {
      fail(`「${item.name}」没有改成「${label}」：${result.message}`, result.kind === 'network' ? () => void changeStatus(item, status, from) : null);
      return;
    }
    const moved = status === 'pending' ? '，移返「待采购」' : item.status === 'pending' ? '，放咗喺「已准备好」' : '';
    succeed(`「${item.name}」标记好喇：${label}${moved}`);
    focusFirst([
      `${itemSelector(item.key)} [data-status-btn="${status}"]`,
      ...neighbours.map((n) => `${itemSelector(n.key)} .shop-item-name`),
      '.shop-done > summary',
    ]);
  };

  const addManual = async (values: ManualValues): Promise<ManualSubmitResult> => {
    const result = await run({ method: 'POST', path: `${basePath}/manual`, payload: values }, 'manual:new');
    if (!result.ok) return { ok: false, message: result.message, field: result.field, current: result.current };
    succeed(`「${values.name}」加咗落采购清单喇`);
    return { ok: true };
  };

  const editManual = async (id: string, values: ManualValues, base: Pick<ShoppingList, 'planVersion' | 'revision'>): Promise<ManualSubmitResult> => {
    const result = await run({ method: 'PUT', path: `${basePath}/manual/${id}`, payload: values }, `manual:${id}`, base);
    if (!result.ok) return { ok: false, message: result.message, field: result.field, current: result.current };
    succeed(`「${values.name}」改好喇`);
    const key = result.list.items.find((i) => i.sources.some((s) => s.kind === 'manual' && s.manualId === id))?.key;
    focusFirst([`[data-manual-edit="${id}"]`, ...(key ? [`${itemSelector(key)} .shop-item-name`] : [])]);
    return { ok: true };
  };

  const markHave = async (keys: string[], base: ShoppingBase): Promise<ShoppingWriteResult> => {
    const result = await run({ method: 'PUT', path: `${basePath}/have`, payload: { keys } }, 'have:batch', base);
    if (result.ok) succeed(`${keys.length} 样都标记为「家里已有」喇，一齐放咗喺「已准备好」`);
    return result;
  };

  const deleteManual = async (id: string, itemName: string): Promise<boolean> => {
    const result = await run({ method: 'DELETE', path: `${basePath}/manual/${id}`, payload: {} }, `manual:${id}`);
    if (!result.ok) {
      fail(`没能删除「${itemName}」的手动补充：${result.message}`, null);
      return false;
    }
    succeed(`「${itemName}」嘅手动补充删咗喇`);
    const remaining = result.list.items.find((i) => i.key === shoppingKey(itemName));
    focusFirst(remaining ? [`${itemSelector(remaining.key)} .shop-item-name`] : []);
    return true;
  };

  return (
    <section className="card shop-section" aria-labelledby="shopping-title" ref={sectionRef}>
      <div className="shop-head">
        <h2 id="shopping-title" className="section-title" tabIndex={-1} ref={headingRef}>
          <ClipboardList aria-hidden="true" />
          采购清单
        </h2>
        {list && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="刷新采购清单"
          >
            <RefreshCw aria-hidden="true" />
            {query.isFetching ? '刷新中…' : '刷新'}
          </button>
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {query.isPending ? (
        <p className="muted">正在加载采购清单…</p>
      ) : !list ? (
        <div className="notice notice-butter small" role="alert">
          <div>
            <p>采购清单加载失败：{query.error?.message}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void query.refetch()}>
              重试
            </button>
          </div>
        </div>
      ) : (
        <ShoppingBody
          list={list}
          online={online}
          busy={busy}
          refreshFailed={query.isError}
          problem={problem}
          onDismissProblem={() => setProblem(null)}
          onStatus={changeStatus}
          onAdd={addManual}
          onEditManual={editManual}
          onDeleteManual={deleteManual}
          onMarkHave={markHave}
        />
      )}
    </section>
  );
}

interface BodyProps {
  list: ShoppingList;
  online: boolean;
  busy: string | null;
  refreshFailed: boolean;
  problem: Problem | null;
  onDismissProblem: () => void;
  onStatus: (item: ShoppingItem, status: ShoppingStatus, from: readonly ShoppingItem[]) => void;
  onAdd: (values: ManualValues) => Promise<ManualSubmitResult>;
  onEditManual: (id: string, values: ManualValues, base: Pick<ShoppingList, 'planVersion' | 'revision'>) => Promise<ManualSubmitResult>;
  onDeleteManual: (id: string, itemName: string) => Promise<boolean>;
  onMarkHave: (keys: string[], base: ShoppingBase) => Promise<ShoppingWriteResult>;
}

function ShoppingBody({ list, online, busy, refreshFailed, problem, onDismissProblem, onStatus, onAdd, onEditManual, onDeleteManual, onMarkHave }: BodyProps) {
  const { keys: have } = usePantry();
  const [haveSession, setHaveSession] = useState<HaveSession | null>(null);
  const sessionCounter = useRef(0);
  const candidates = pantryCandidates(list.items, have);
  const openHaveReview = () => {
    sessionCounter.current += 1;
    setHaveSession({
      id: sessionCounter.current,
      keys: candidates.map((i) => i.key),
      base: { planVersion: list.planVersion, revision: list.revision },
    });
  };
  const closeHaveReview = (saved: boolean) => {
    if (!saved && busy === 'have:batch') return;
    setHaveSession(null);
    if (!saved) return;
    // The trigger disappears when nothing pending matches any more; fall back to the heading.
    window.requestAnimationFrame(() => {
      const trigger = document.querySelector('[data-have-review]');
      if (isVisible(trigger)) trigger.focus();
      else document.getElementById('shopping-title')?.focus();
    });
  };
  // Keep editing outside moving ingredient rows. Refetches can move/remove a row without
  // unmounting the form or changing the revision the user's input was based on.
  const [editing, setEditing] = useState<{
    item: ShoppingManualItem;
    base: Pick<ShoppingList, 'planVersion' | 'revision'>;
  } | null>(null);
  const { pending, done } = partitionShopping(list.items);
  const currentEditing = editing ? list.manual.find((m) => m.id === editing.item.id) : undefined;
  const remoteEditChanged = Boolean(editing && currentEditing &&
    (currentEditing.name !== editing.item.name || currentEditing.quantity !== editing.item.quantity || currentEditing.note !== editing.item.note));
  const closeEdit = () => {
    if (busy !== null) return;
    const id = editing?.item.id;
    setEditing(null);
    window.requestAnimationFrame(() => {
      const button = id ? document.querySelector('[data-manual-edit="' + id + '"]') : null;
      if (isVisible(button)) button.focus();
      else document.getElementById('shopping-title')?.focus();
    });
  };
  const beginEdit = (id: string) => {
    const item = list.manual.find((m) => m.id === id);
    if (item) setEditing({ item: { ...item }, base: { planVersion: list.planVersion, revision: list.revision } });
  };
  // Offline keeps the controls in place (explained by a notice) but nothing can be sent.
  const rowProps = (from: readonly ShoppingItem[]) => ({
    writable: list.writable,
    busy: busy !== null || !online,
    onStatus: (item: ShoppingItem, status: ShoppingStatus) => onStatus(item, status, from),
    onBeginEdit: beginEdit,
    onDeleteManual,
  });
  const manualFull = list.manual.length >= SHOPPING_LIMITS.manualItems;

  return (
    <>
      <div className="shop-overview">
        <p className="shop-counts">
          <span><span>待采购</span> <strong>{list.counts.pending}</strong></span>
          <span><span>家里已有</span> <strong>{list.counts.have}</strong></span>
          <span><span>已买好</span> <strong>{list.counts.bought}</strong></span>
        </p>
        {list.items.length > 0 && (
          <div className="shop-progress">
            <span className="small">已准备好 {list.counts.have + list.counts.bought} / {list.items.length} 样</span>
            <progress
              aria-label="采购准备进度"
              value={list.counts.have + list.counts.bought}
              max={list.items.length}
            />
          </div>
        )}
      </div>
      <p className="muted small">
        按食材种类计数。「家里已有」表示够这一餐用。状态和补充项会和另一台设备共享，打开或切回这个页面时自动刷新。
      </p>

      {list.lockReason && <p className="notice notice-sky small">{LOCK_TEXT[list.lockReason]}</p>}
      {list.writable && !online && (
        <p className="notice notice-butter small">
          <WifiOff aria-hidden="true" />
          <span>现在离线：可以查看清单，恢复网络后才能修改。</span>
        </p>
      )}
      {refreshFailed && <p className="muted small">刷新失败，显示的是上次加载的内容。</p>}
      {problem && (
        <div className="notice notice-butter small shop-problem" role="alert">
          <div>
            <p>{problem.message}</p>
            <div className="shop-problem-actions">
              {problem.retry && (
                <button type="button" className="btn btn-primary btn-sm" onClick={problem.retry} disabled={busy !== null}>
                  重试
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onDismissProblem}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      <MissingIngredientsNotice names={list.dishesWithoutIngredients} />

      {list.writable && candidates.length > 0 && (
        <div className="shop-pantry">
          <p className="small">
            <Refrigerator aria-hidden="true" className="inline-icon" /> 有 {candidates.length} 样待采购出现在这台设备记下的现有食材里。
          </p>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-have-review
            aria-haspopup="dialog"
            onClick={openHaveReview}
            disabled={busy !== null || !online || editing !== null}
          >
            核对后标记家里已有
          </button>
        </div>
      )}

      {list.items.length === 0 ? (
        <p className="muted shop-empty">张清单仲未有嘢。{list.writable ? '仲有嘢要买，可以喺下面自己加。' : ''}</p>
      ) : pending.length === 0 ? (
        <p className="shop-empty shop-all-done">要买嘅都准备好晒。</p>
      ) : (
        <ul className="shop-list" aria-label="待采购">
          {pending.map((item) => (
            <ShoppingItemRow key={item.key} item={item} saving={busy === `status:${item.key}`} {...rowProps(pending)} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <details className="shop-done">
          <summary>
            已准备好（{done.length}）<span className="muted small">家里已有 / 已买好{list.writable ? '，可移回待采购' : ''}</span>
          </summary>
          <ul className="shop-list" aria-label="已准备好">
            {done.map((item) => (
              <ShoppingItemRow key={item.key} item={item} saving={busy === `status:${item.key}`} {...rowProps(done)} />
            ))}
          </ul>
        </details>
      )}

      <DishShoppingNotes notes={list.dishNotes} />

      <Sheet open={editing !== null} onClose={closeEdit} title="编辑手动补充项">
        {editing && (
          <>
            {!list.writable && <p className="notice notice-sky small">{list.lockReason ? LOCK_TEXT[list.lockReason] : '清单目前只能查看。'}你的输入仍保留在下面。</p>}
            {!currentEditing && <p className="notice notice-butter small" role="alert">这条补充项已在其他设备删除。你的输入仍保留，可复制需要的内容后关闭。</p>}
            {remoteEditChanged && <p className="notice notice-sky small">其他设备已修改这条补充项，你的输入仍保留。当前记录：{[currentEditing?.name, currentEditing?.quantity, currentEditing?.note].filter(Boolean).join(' · ')}。请核对后再保存。</p>}
            <ManualItemForm
              key={editing.item.id}
              mode="edit"
              initial={{ name: editing.item.name, quantity: editing.item.quantity, note: editing.item.note }}
              busy={busy !== null}
              disabled={!list.writable || !online || !currentEditing}
              onCancel={closeEdit}
              onSubmit={async (values) => {
                const result = await onEditManual(editing.item.id, values, editing.base);
                if (result.ok) setEditing(null);
                else if (result.current) {
                  const current = result.current;
                  // A second save is an explicit confirmation after seeing the conflict.
                  setEditing((prev) => prev ? { ...prev, base: { planVersion: current.planVersion, revision: current.revision } } : prev);
                }
                return result;
              }}
            />
          </>
        )}
      </Sheet>

      <PantryHaveSheet
        session={haveSession}
        list={list}
        online={online}
        busy={busy !== null && busy !== 'have:batch'}
        lockText={list.lockReason ? LOCK_TEXT[list.lockReason] : !list.writable ? '清单目前只能查看。' : null}
        onSubmit={onMarkHave}
        onClose={closeHaveReview}
      />

      {list.writable && (
        <div className="shop-add">
          <h3 className="shop-subtitle">手动补充</h3>
          <p className="muted small">
            菜谱以外还要买的东西。只需要名称；和菜谱里同名的会合在一起，并标明是手动补充。最多 {SHOPPING_LIMITS.manualItems} 项。
          </p>
          {manualFull ? (
            <p className="muted small">已经补充了 {SHOPPING_LIMITS.manualItems} 项，删掉一些才能再加。</p>
          ) : (
            <ManualItemForm mode="create" busy={busy !== null} disabled={!online} onSubmit={onAdd} />
          )}
        </div>
      )}
    </>
  );
}

import { ArrowLeft, CircleCheck, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Loading } from '../../components/Loading';
import { Sheet } from '../../components/Sheet';
import { rowGroup } from '../../lib/bulkQueue';
import { BulkRowCard } from './BulkRowCard';
import { BatchLocation, BatchTags, PasteBox, QueueToolbar, type RowFilter } from './BulkControls';
import { venueLocationOptions } from '../../lib/venueForm';
import { useBulkImport, type BulkImport, type CommitOutcome } from './useBulkImport';

function Outcome({ outcome }: { outcome: CommitOutcome }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), [outcome]);
  return (
    <div ref={ref} tabIndex={-1} className="notice notice-sky bulk-outcome" role="status">
      <CircleCheck aria-hidden="true" />
      <div>
        <strong>
          {outcome.replayed ? '已确认上次的导入结果' : '导入完成'}：新增 {outcome.created} 家
          {outcome.duplicates > 0 && `，跳过重复 ${outcome.duplicates} 行`}
          {outcome.errors > 0 && `，${outcome.errors} 行需要修改`}
        </strong>
        <p className="small">
          已导入的行变为只读，不会再次导入。地址、点评和照片可以之后在 <Link to="/admin/restaurants">店铺列表</Link> 里编辑补充。
        </p>
      </div>
    </div>
  );
}

function CommitBar({ bulk }: { bulk: BulkImport }) {
  const pending = bulk.state.pendingCommit;
  const count = pending ? pending.rowIds.length : bulk.counts.selected;
  return (
    <div className="bulk-commit">
      {pending && !bulk.commitBusy && (
        <p className="small bulk-commit-note">
          上一批 {pending.rowIds.length} 行已经提交，但还没确认结果。重新提交会得到同一个结果，不会重复导入。
        </p>
      )}
      {bulk.commitError && (
        <p className="field-error" role="alert">
          {bulk.commitError}
        </p>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={() => void bulk.commit()} disabled={bulk.commitBusy || count === 0}>
        <Upload aria-hidden="true" />
        {bulk.commitBusy ? '导入中…' : pending ? `重新提交（${count} 家）` : `导入已选的 ${count} 家`}
      </button>
    </div>
  );
}

const matchesFilter = (filter: RowFilter, group: ReturnType<typeof rowGroup>) =>
  filter === 'all' ||
  (filter === 'attention' && group === 'attention') ||
  (filter === 'importable' && group === 'importable') ||
  (filter === 'duplicate' && group === 'duplicate') ||
  (filter === 'imported' && group === 'imported');

/** 批量导入: paste many Google Maps links, review an editable preview, then create in one request. */
export function BulkImportPage() {
  const bulk = useBulkImport();
  const [filter, setFilter] = useState<RowFilter>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const { state, info } = bulk;
  const suggestions = useMemo(() => [...new Set((bulk.restaurants.data ?? []).flatMap((r) => r.tags))].sort(), [bulk.restaurants.data]);
  const visible = state.rows.filter((r) => matchesFilter(filter, rowGroup(r, info.get(r.id))));
  const lockedIds = new Set(state.pendingCommit?.rowIds ?? []);
  const locationOptions = useMemo(() => venueLocationOptions(bulk.restaurants.data ?? []), [bulk.restaurants.data]);
  const actions = useMemo(
    () => ({
      edit: bulk.edit,
      retry: bulk.retry,
      setManual: bulk.setManual,
      toggle: bulk.toggle,
      remove: bulk.remove,
      editLocation: bulk.editLocation,
      setPurposes: bulk.setPurposes,
      retryGeo: bulk.retryGeo,
    }),
    [bulk.edit, bulk.retry, bulk.setManual, bulk.toggle, bulk.remove, bulk.editLocation, bulk.setPurposes, bulk.retryGeo],
  );

  return (
    <div className="admin-page bulk-page">
      <Link to="/admin/restaurants" className="back-link">
        <ArrowLeft aria-hidden="true" /> 返回店铺
      </Link>
      <div className="admin-page-head">
        <div>
          <h1>批量导入店铺</h1>
          <p className="muted small">
            粘贴 Google 地图链接，自动识别店名（和尽量识别地区），核对、补分类、地区和前台入口后一次导入。只需要店名和地图链接，其他信息之后在店铺编辑里补充。
          </p>
        </div>
      </div>

      {bulk.restored && <p className="notice notice-sky small">已恢复这个标签页里还没完成的导入队列。</p>}
      {bulk.discarded && <p className="notice notice-butter small">这个标签页里保存的导入草稿无法读取，已丢弃。</p>}
      {!bulk.storageOk && <p className="notice notice-butter small">浏览器没有保存草稿，刷新页面会丢失队列，请尽快导入。</p>}
      <p className="muted small bulk-draft-hint">
        队列只保存在当前浏览器标签页：刷新或离开本页都不会丢失，关闭标签页后清除。识别只生成预览，点击「导入已选」后才会新增餐厅。
      </p>

      <PasteBox onAdd={bulk.addPaste} />
      <p className="field-hint">
        会检查已有餐厅和本次队列里的重复项；同店的不同旧短链接可能无法识别为重复，请核对店名与分店。
      </p>

      {bulk.restaurants.isPending && state.rows.length > 0 && <Loading />}
      {bulk.restaurants.isError && <p className="error-text">读取现有餐厅失败，暂时无法检查重复：{bulk.restaurants.error.message}</p>}

      {state.rows.length > 0 && (
        <>
          <QueueToolbar
            counts={bulk.counts}
            running={bulk.running}
            waitSeconds={bulk.waitSeconds}
            paused={bulk.paused}
            filter={filter}
            onFilter={setFilter}
            onStart={bulk.start}
            onPause={bulk.pause}
            onRetryAll={bulk.retryAllFailed}
            onSelectAll={bulk.selectAll}
            onClearImported={bulk.clearImported}
            onClearAll={() => setConfirmClear(true)}
            withGeo={bulk.withGeo}
            onWithGeo={bulk.setWithGeo}
            geoFailed={bulk.geoFailed}
            onRetryFailedGeo={bulk.retryFailedGeo}
          />
          <BatchTags selected={bulk.counts.selected} suggestions={suggestions} onApply={bulk.addBatchTags} />
          <BatchLocation selected={bulk.counts.selected} options={locationOptions} onFill={bulk.fillLocation} onPurposes={bulk.fillPurposes} />
          {bulk.outcome && <Outcome outcome={bulk.outcome} />}
          <ul className="bulk-rows" aria-label="导入队列">
            {visible.map((row) => (
              <BulkRowCard key={row.id} row={row} info={info.get(row.id)!} locked={lockedIds.has(row.id)} actions={actions} />
            ))}
          </ul>
          {visible.length === 0 && <p className="muted">这个筛选下没有行。</p>}
          <CommitBar bulk={bulk} />
        </>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {bulk.announcement}
      </div>

      <Sheet
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空导入队列？"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-danger-solid"
              onClick={() => {
                bulk.clearAll();
                setConfirmClear(false);
              }}
            >
              清空
            </button>
          </>
        }
      >
        <p>队列里还没导入的行和修改都会删除，已经导入的餐厅不受影响。{state.pendingCommit && '正在等待结果的那一批会保留，确认结果后再清除。'}</p>
      </Sheet>
    </div>
  );
}

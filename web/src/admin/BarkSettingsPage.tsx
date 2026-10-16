import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Pencil, Plus, Save, Send, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { BarkDeviceView, BarkSettingsView, BarkTestResult } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { Loading } from '../components/Loading';
import { Sheet } from '../components/Sheet';
import { useToast } from '../components/Toast';
import { BarkDeviceForm, type DevicePayload } from './BarkDeviceForm';

const QUERY_KEY = ['admin', 'bark'];
const DEVICES = '/admin/settings/bark/devices';
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

type TestState = { kind: 'one'; id: string; ok: boolean; text: string } | { kind: 'all'; results: BarkTestResult[] } | { kind: 'error'; text: string };

export function BarkSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: () => api<BarkSettingsView>('GET', '/admin/settings/bark') });
  const [enabled, setEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [editing, setEditing] = useState<BarkDeviceView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<BarkDeviceView | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState | null>(null);

  useEffect(() => {
    if (settings.data) {
      setEnabled(settings.data.enabled);
      setServerUrl(settings.data.serverUrl);
    }
  }, [settings.data?.enabled, settings.data?.serverUrl]);

  const apply = (data: BarkSettingsView) => queryClient.setQueryData(QUERY_KEY, data);

  const saveGlobal = useMutation({
    mutationFn: () => api<BarkSettingsView>('PUT', '/admin/settings/bark', { json: { enabled, serverUrl } }),
    onSuccess: (data) => {
      apply(data);
      toast('推送设置已保存', 'success');
    },
    onError: (err) => toast(errorText(err, '保存失败'), 'error'),
  });

  const saveDevice = useMutation({
    mutationFn: (payload: DevicePayload) =>
      editing && editing !== 'new'
        ? api<BarkSettingsView>('PATCH', `${DEVICES}/${editing.id}`, { json: payload })
        : api<BarkSettingsView>('POST', DEVICES, { json: payload }),
    onSuccess: (data) => {
      apply(data);
      setEditing(null);
      toast('设备已保存', 'success');
    },
    onError: (err) => setFormError(errorText(err, '保存失败')),
  });

  const toggleDevice = useMutation({
    mutationFn: (d: BarkDeviceView) => api<BarkSettingsView>('PATCH', `${DEVICES}/${d.id}`, { json: { enabled: !d.enabled } }),
    onSuccess: apply,
    onError: (err) => toast(errorText(err, '操作失败'), 'error'),
  });

  const removeDevice = useMutation({
    mutationFn: (d: BarkDeviceView) => api<BarkSettingsView>('DELETE', `${DEVICES}/${d.id}`),
    onSuccess: (data) => {
      apply(data);
      setDeleting(null);
      toast('设备已删除', 'success');
    },
    onError: (err) => {
      setDeleting(null);
      toast(errorText(err, '删除失败'), 'error');
    },
  });

  const testOne = useMutation({
    mutationFn: (d: BarkDeviceView) => api('POST', `${DEVICES}/${d.id}/test`),
    onMutate: () => setTestState(null),
    onSuccess: (_data, d) => setTestState({ kind: 'one', id: d.id, ok: true, text: `「${d.label}」：推送服务已接收，请看看设备有没有收到。` }),
    onError: (err, d) => setTestState({ kind: 'one', id: d.id, ok: false, text: `「${d.label}」：${errorText(err, '测试失败')}` }),
  });

  const testAll = useMutation({
    mutationFn: () => api<{ accepted: boolean; results: BarkTestResult[] }>('POST', '/admin/settings/bark/test'),
    onMutate: () => setTestState(null),
    onSuccess: (data) => setTestState({ kind: 'all', results: data.results }),
    onError: (err) => setTestState({ kind: 'error', text: errorText(err, '测试失败') }),
  });

  if (settings.isPending) return <Loading />;
  if (settings.isError) return <p className="error-text">加载失败：{settings.error.message}</p>;
  const s = settings.data;
  const enabledCount = s.devices.filter((d) => d.enabled).length;
  const full = s.devices.length >= s.maxDevices;

  const submitGlobal = (e: FormEvent) => {
    e.preventDefault();
    saveGlobal.mutate();
  };
  const openEditor = (target: BarkDeviceView | 'new') => {
    setFormError(null);
    setEditing(target);
  };
  const status = s.configured ? '已启用' : !s.enabled ? '未启用' : enabledCount === 0 ? '没有启用的设备' : '服务器地址无效';

  return (
    <div className="admin-page narrow">
      <div className="admin-page-head">
        <div>
          <h1>推送设置</h1>
          <p className="muted small">计划新建、修改、取消时，通过 Bark 推送到所有启用的设备。不会发送定时提醒。</p>
        </div>
        <span className={`badge ${s.configured ? 'badge-ok' : 'badge-off'}`}>{status}</span>
      </div>

      {!s.configured && (
        <div className="notice notice-butter small">
          <BellRing aria-hidden="true" />
          <div>
            <p>
              <strong>如何配置：</strong>在每台 iPhone / iPad 上安装 Bark App，把首页地址里的设备 Key 添加到下面的设备列表，再打开「启用 Bark 推送」。
            </p>
            <p>未配置期间产生的通知会标记为「通知未配置」，配置好后可在「通知」页一键重试。</p>
          </div>
        </div>
      )}

      <form className="card settings-form" onSubmit={submitGlobal} aria-labelledby="bark-global-title">
        <h2 id="bark-global-title" className="section-title">
          总开关与服务器
        </h2>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="switch" aria-hidden="true" />
          <span>启用 Bark 推送（关闭后所有设备都不推送）</span>
        </label>
        <div className="field">
          <label className="field-label" htmlFor="bark-server">
            Bark 服务器地址（所有设备共用）
          </label>
          <input id="bark-server" className="input" type="url" inputMode="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} required />
          <p className="muted small">默认官方服务器 https://api.day.app，自建服务器填你的地址。</p>
        </div>
        <div className="stack-actions">
          <button type="submit" className="btn btn-primary" disabled={saveGlobal.isPending}>
            <Save aria-hidden="true" /> {saveGlobal.isPending ? '保存中…' : '保存设置'}
          </button>
        </div>
      </form>

      <section className="card settings-form" aria-labelledby="bark-devices-title">
        <div className="device-head">
          <h2 id="bark-devices-title" className="section-title">
            接收设备（{s.devices.length}/{s.maxDevices}）
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEditor('new')} disabled={full}>
            <Plus aria-hidden="true" /> 添加设备
          </button>
        </div>
        {s.devices.length === 0 ? (
          <p className="muted">还没有设备。添加至少一台设备后才能收到推送。</p>
        ) : (
          <ul className="device-list">
            {s.devices.map((d) => (
              <li key={d.id} className={`device-item ${d.enabled ? '' : 'is-inactive'}`}>
                <Smartphone aria-hidden="true" className="device-icon" />
                <div className="device-text">
                  <strong>{d.label}</strong>
                  <span className="muted small mono">{d.keyMasked}</span>
                </div>
                <label className="switch-row compact">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={d.enabled}
                    onChange={() => toggleDevice.mutate(d)}
                    aria-label={`${d.label} ${d.enabled ? '接收中' : '已暂停'}`}
                  />
                  <span className="switch" aria-hidden="true" />
                  <span className="small">{d.enabled ? '接收' : '暂停'}</span>
                </label>
                <div className="admin-item-actions">
                  <button type="button" className="icon-btn" aria-label={`测试 ${d.label}`} onClick={() => testOne.mutate(d)} disabled={testOne.isPending}>
                    <Send aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`编辑 ${d.label}`} onClick={() => openEditor(d)}>
                    <Pencil aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`删除 ${d.label}`} onClick={() => setDeleting(d)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {full && <p className="muted small">最多 {s.maxDevices} 台设备。</p>}
        <div className="stack-actions">
          <button type="button" className="btn btn-butter" onClick={() => testAll.mutate()} disabled={!s.configured || testAll.isPending}>
            <BellRing aria-hidden="true" /> {testAll.isPending ? '发送中…' : `测试全部启用的设备（${enabledCount}）`}
          </button>
        </div>
        <TestResultView state={testState} />
      </section>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '添加设备' : `编辑「${editing?.label ?? ''}」`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="submit" form="bark-device-form" className="btn btn-primary" disabled={saveDevice.isPending}>
              {saveDevice.isPending ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {editing !== null && (
          <BarkDeviceForm
            key={editing === 'new' ? 'new' : editing.id}
            device={editing === 'new' ? null : editing}
            serverError={formError}
            onSubmit={(payload) => {
              setFormError(null);
              saveDevice.mutate(payload);
            }}
          />
        )}
      </Sheet>

      <Sheet
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`删除「${deleting?.label ?? ''}」？`}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary btn-danger-solid" onClick={() => deleting && removeDevice.mutate(deleting)} disabled={removeDevice.isPending}>
              删除
            </button>
          </>
        }
      >
        <p>删除后这台设备不再收到任何推送，正在重试的通知也会跳过它。只想暂时不收，可以改用「暂停」。</p>
      </Sheet>
    </div>
  );
}

function TestResultView({ state }: { state: TestState | null }) {
  if (!state) return null;
  if (state.kind === 'all') {
    return (
      <ul className="test-results" role="status">
        {state.results.map((r) => (
          <li key={r.id} className={r.ok ? 'success-text' : 'error-text'}>
            {r.label}：{r.ok ? '推送服务已接收' : r.error}
          </li>
        ))}
      </ul>
    );
  }
  const ok = state.kind === 'one' && state.ok;
  return (
    <p className={ok ? 'success-text' : 'error-text'} role="status">
      {state.text}
    </p>
  );
}

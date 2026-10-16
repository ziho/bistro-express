import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { BarkSettingsView } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { Loading } from '../components/Loading';
import { useToast } from '../components/Toast';

export function BarkSettingsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['admin', 'bark'], queryFn: () => api<BarkSettingsView>('GET', '/admin/settings/bark') });
  const [enabled, setEnabled] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [deviceKey, setDeviceKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (settings.data) {
      setEnabled(settings.data.enabled);
      setServerUrl(settings.data.serverUrl);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api<BarkSettingsView>('PUT', '/admin/settings/bark', {
        json: { enabled, serverUrl, deviceKey: clearKey ? '' : deviceKey.trim() || null },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin', 'bark'], data);
      setDeviceKey('');
      setClearKey(false);
      toast('推送设置已保存', 'success');
    },
    onError: (err) => toast(err instanceof ApiError ? err.message : '保存失败', 'error'),
  });

  const test = useMutation({
    mutationFn: () => api('POST', '/admin/settings/bark/test'),
    onSuccess: () => setTestResult({ ok: true, text: '推送服务已接收测试消息，请看看手机有没有收到。' }),
    onError: (err) => setTestResult({ ok: false, text: err instanceof ApiError ? err.message : '测试失败' }),
  });

  if (settings.isPending) return <Loading />;
  if (settings.isError) return <p className="error-text">加载失败：{settings.error.message}</p>;
  const s = settings.data;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTestResult(null);
    save.mutate();
  };

  return (
    <div className="admin-page narrow">
      <div className="admin-page-head">
        <div>
          <h1>推送设置</h1>
          <p className="muted small">计划新建、修改、取消时，通过 Bark 推送到主厨的 iPhone。不会发送定时提醒。</p>
        </div>
        <span className={`badge ${s.configured ? 'badge-ok' : 'badge-off'}`}>{s.configured ? '已启用' : s.enabled ? '缺少设备 Key' : '未配置'}</span>
      </div>

      {!s.configured && (
        <div className="notice notice-butter small">
          <BellRing aria-hidden="true" />
          <div>
            <p>
              <strong>如何配置：</strong>在 iPhone 上安装 Bark App，复制首页地址中 <code>/</code> 后面的那段设备 Key，粘贴到下面并启用。
            </p>
            <p>未配置期间产生的通知会标记为「通知未配置」，配置好后可在「通知」页一键重试。</p>
          </div>
        </div>
      )}

      <form className="card settings-form" onSubmit={submit}>
        <label className="switch-row">
          <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="switch" aria-hidden="true" />
          <span>启用 Bark 推送</span>
        </label>
        <div className="field">
          <label className="field-label" htmlFor="bark-server">
            Bark 服务器地址
          </label>
          <input id="bark-server" className="input" type="url" inputMode="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} required />
          <p className="muted small">默认官方服务器 https://api.day.app，自建服务器填你的地址。</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="bark-key">
            设备 Key
          </label>
          <input
            id="bark-key"
            className="input"
            type="password"
            autoComplete="off"
            placeholder={s.deviceKeyMasked ? `已保存：${s.deviceKeyMasked}（留空则不修改）` : '粘贴 Bark 设备 Key'}
            value={deviceKey}
            onChange={(e) => setDeviceKey(e.target.value)}
            disabled={clearKey}
          />
          {s.deviceKeyMasked && (
            <label className="check-row small">
              <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
              清除已保存的 Key
            </label>
          )}
          <p className="muted small">Key 只保存在服务器私有数据里，读取时始终打码显示。</p>
        </div>
        <div className="stack-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            <Save aria-hidden="true" /> {save.isPending ? '保存中…' : '保存设置'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => test.mutate()} disabled={!s.configured || test.isPending}>
            <BellRing aria-hidden="true" /> {test.isPending ? '发送中…' : '发送测试推送'}
          </button>
        </div>
        {testResult && (
          <p className={testResult.ok ? 'success-text' : 'error-text'} role="status">
            {testResult.text}
          </p>
        )}
      </form>
    </div>
  );
}

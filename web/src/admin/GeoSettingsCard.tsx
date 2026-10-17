import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPinned, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { GeoSettingsView } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast';

const KEY = ['admin', 'geo'];

/**
 * 地区识别 (admin only): on/off and a Nominatim-compatible service address. Changing it takes effect
 * at once (no code update); waiting lookups are dropped and results are cached per service.
 */
export function GeoSettingsCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: KEY, queryFn: () => api<GeoSettingsView>('GET', '/admin/geo/settings') });
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setEnabled(settings.data.enabled);
      setBaseUrl(settings.data.baseUrl);
    }
  }, [settings.data?.enabled, settings.data?.baseUrl]);

  const save = useMutation({
    mutationFn: () => api<GeoSettingsView>('PUT', '/admin/geo/settings', { json: { enabled, baseUrl } }),
    onSuccess: (data) => {
      queryClient.setQueryData(KEY, data);
      setError(null);
      toast('地区识别设置已保存', 'success');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.isPending) save.mutate();
  };

  if (settings.isPending) return null;
  if (settings.isError) return <p className="error-text">地区识别设置加载失败：{settings.error.message}</p>;
  const s = settings.data;

  return (
    <form className="card settings-form" onSubmit={submit} aria-labelledby="geo-title">
      <h2 id="geo-title" className="section-title">
        <MapPinned aria-hidden="true" /> 地区识别
      </h2>
      <p className="muted small">
        添加或批量导入店铺时，可以点「识别地区」，用 Google 地图链接里店铺自己的坐标查一次国家、省/州和城市（Nominatim
        兼容服务）。只在你点击时查询，后台不会自动或定时查询；全站每 {(s.minIntervalMs / 1000).toFixed(1)} 秒最多 1 次，结果缓存 {s.cacheDays}{' '}
        天。查不到或关闭时都可以手动填写。
      </p>
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
        <span>{enabled ? '已开启地区识别' : '已关闭地区识别（只手动填写）'}</span>
      </label>
      <div className="field">
        <label className="field-label" htmlFor="geo-base">
          服务地址
        </label>
        <input
          id="geo-base"
          className="input"
          type="url"
          inputMode="url"
          value={baseUrl}
          aria-invalid={error ? true : undefined}
          aria-describedby="geo-base-hint"
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setError(null);
          }}
        />
        <p id="geo-base-hint" className="field-hint">
          默认是 OpenStreetMap 公共服务 {s.defaultBaseUrl}，须遵守其
          <a href={s.policyUrl} target="_blank" rel="noopener noreferrer">
            使用政策
          </a>
          （无服务保证，可能限流）。也可以填自建的 Nominatim 兼容地址。{s.isDefault ? '当前使用默认设置。' : ''}
        </p>
        {baseUrl !== s.defaultBaseUrl && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBaseUrl(s.defaultBaseUrl)}>
            恢复默认地址
          </button>
        )}
      </div>
      <p className="muted small">
        地区数据 ©{' '}
        <a href={s.attributionUrl} target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors
        </a>
        。
      </p>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>
        <Save aria-hidden="true" /> {save.isPending ? '保存中…' : '保存地区识别设置'}
      </button>
    </form>
  );
}

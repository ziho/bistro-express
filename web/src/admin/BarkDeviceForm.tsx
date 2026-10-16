import { useState, type FormEvent } from 'react';
import { BARK_LIMITS } from '../../../shared/constants';
import type { BarkDeviceView } from '../../../shared/types';

export interface DevicePayload {
  label: string;
  /** null = keep the stored key (edit only). */
  deviceKey: string | null;
  enabled: boolean;
}

interface Props {
  device: BarkDeviceView | null;
  serverError: string | null;
  onSubmit: (payload: DevicePayload) => void;
}

/** Add/edit one Bark device. The stored key is never shown — only its masked form. */
export function BarkDeviceForm({ device, serverError, onSubmit }: Props) {
  const [label, setLabel] = useState(device?.label ?? '');
  const [deviceKey, setDeviceKey] = useState('');
  const [enabled, setEnabled] = useState(device?.enabled ?? true);
  const [errors, setErrors] = useState<{ label?: string; deviceKey?: string }>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!label.trim()) next.label = '请填写设备名称，例如「主厨的 iPhone」';
    if (!device && !deviceKey.trim()) next.deviceKey = '请粘贴 Bark 设备 Key';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSubmit({ label: label.trim(), deviceKey: deviceKey.trim() || null, enabled });
  };

  return (
    <form id="bark-device-form" className="item-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field-label" htmlFor="device-label">
          设备名称 <span aria-hidden="true">*</span>
        </label>
        <input
          id="device-label"
          className="input"
          maxLength={BARK_LIMITS.label}
          placeholder="比如：主厨的 iPhone、厨房 iPad"
          value={label}
          aria-invalid={errors.label ? true : undefined}
          aria-describedby={errors.label ? 'device-label-err' : undefined}
          onChange={(e) => setLabel(e.target.value)}
        />
        {errors.label && (
          <p id="device-label-err" className="field-error">
            {errors.label}
          </p>
        )}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="device-key">
          设备 Key {!device && <span aria-hidden="true">*</span>}
        </label>
        <input
          id="device-key"
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={device ? `已保存：${device.keyMasked}（留空则不修改）` : '粘贴 Key，或整段 https://api.day.app/… 地址'}
          value={deviceKey}
          aria-invalid={errors.deviceKey ? true : undefined}
          aria-describedby={`device-key-hint${errors.deviceKey ? ' device-key-err' : ''}`}
          onChange={(e) => setDeviceKey(e.target.value)}
        />
        <p id="device-key-hint" className="muted small">
          在 Bark App 首页复制地址，Key 是服务器地址后面的那一段。Key 只保存在服务器私有数据里，之后只会打码显示。
        </p>
        {errors.deviceKey && (
          <p id="device-key-err" className="field-error">
            {errors.deviceKey}
          </p>
        )}
      </div>
      <label className="switch-row">
        <input type="checkbox" role="switch" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span className="switch" aria-hidden="true" />
        <span>{enabled ? '接收推送' : '暂停接收（保留设备）'}</span>
      </label>
      {serverError && (
        <p className="error-text" role="alert">
          {serverError}
        </p>
      )}
    </form>
  );
}

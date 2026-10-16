import { BARK_LIMITS } from '../../shared/constants.js';
import type { BarkDeviceView, BarkSettingsView } from '../../shared/types.js';
import { isHttpUrl } from '../lib/validation.js';
import type { BarkDevice, BarkDeviceRepo } from '../repos/barkDevices.js';
import type { SettingsRepo } from '../repos/misc.js';
import { ProviderError, type NotificationProvider, type PushMessage, type Recipient } from './types.js';

/** Global Bark settings. Device keys live in the `bark_devices` table, never here. */
export interface BarkSettings {
  enabled: boolean;
  serverUrl: string;
}

/** What a single push needs. */
export interface BarkTarget {
  serverUrl: string;
  deviceKey: string;
}

const SETTINGS_KEY = 'notify.bark';
export const DEFAULT_BARK_SERVER = 'https://api.day.app';
const TIMEOUT_MS = 10_000;
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{4,128}$/;

export function readBarkSettings(settings: SettingsRepo): BarkSettings {
  const stored = settings.get<Partial<BarkSettings>>(SETTINGS_KEY) ?? {};
  return {
    enabled: stored.enabled === true,
    serverUrl: typeof stored.serverUrl === 'string' && stored.serverUrl ? stored.serverUrl : DEFAULT_BARK_SERVER,
  };
}

export function writeBarkSettings(settings: SettingsRepo, value: BarkSettings, now: Date): void {
  settings.set(SETTINGS_KEY, { enabled: value.enabled, serverUrl: value.serverUrl }, now);
}

/** Channel is usable at all (global switch + valid server), regardless of devices. */
export function isBarkChannelOn(s: BarkSettings): boolean {
  return s.enabled && isHttpUrl(s.serverUrl);
}

/**
 * Accepts a bare key or a pasted Bark URL such as `https://api.day.app/<key>/…` (the Bark app
 * shows keys that way). Returns null when the result is not a plausible key.
 */
export function normalizeDeviceKey(raw: string): string | null {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname.split('/').filter(Boolean)[0] ?? '';
    } catch {
      return null;
    }
  }
  return DEVICE_KEY_RE.test(value) ? value : null;
}

export function maskKey(key: string): string | null {
  if (!key) return null;
  if (key.length <= 6) return '•'.repeat(key.length);
  return `${key.slice(0, 2)}${'•'.repeat(Math.min(12, key.length - 4))}${key.slice(-2)}`;
}

export function deviceView(d: BarkDevice): BarkDeviceView {
  return {
    id: d.id,
    label: d.label,
    keyMasked: maskKey(d.deviceKey) ?? '',
    enabled: d.enabled,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function barkSettingsView(s: BarkSettings, devices: BarkDevice[]): BarkSettingsView {
  return {
    enabled: s.enabled,
    serverUrl: s.serverUrl,
    deviceKeyMasked: devices[0] ? maskKey(devices[0].deviceKey) : null,
    configured: isBarkChannelOn(s) && devices.some((d) => d.enabled),
    devices: devices.map(deviceView),
    maxDevices: BARK_LIMITS.maxDevices,
  };
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Remove the device key from any text that might be logged or shown. */
function scrub(text: string, key: string): string {
  return key ? text.split(key).join('***') : text;
}

export async function sendBark(s: BarkTarget, message: PushMessage, fetchImpl: FetchLike = fetch): Promise<void> {
  const endpoint = `${s.serverUrl.replace(/\/+$/, '')}/push`;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        device_key: s.deviceKey,
        title: message.title,
        body: message.body,
        group: message.group,
        url: message.url,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? '请求超时' : '网络错误';
    throw new ProviderError(`Bark ${reason}`);
  }
  let payload: { code?: number; message?: string } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // Non-JSON response handled below.
  }
  if (!response.ok || payload.code !== 200) {
    const detail = scrub(String(payload.message ?? response.statusText ?? ''), s.deviceKey).slice(0, 120);
    throw new ProviderError(`Bark 返回 ${response.status}${detail ? `：${detail}` : ''}`);
  }
}

/** Reason a device cannot receive right now, or null. Shared by the provider and admin tests. */
export function deviceUnavailableReason(s: BarkSettings, device: BarkDevice | null): string | null {
  if (!s.enabled) return 'Bark 推送已关闭';
  if (!isHttpUrl(s.serverUrl)) return 'Bark 服务器地址无效';
  if (!device) return '设备已删除';
  if (!device.enabled) return '设备已停用';
  return null;
}

/** Reads settings and devices on every call, so admin changes apply to queued retries at once. */
export function createBarkProvider(settings: SettingsRepo, devices: BarkDeviceRepo, fetchImpl?: FetchLike): NotificationProvider {
  return {
    name: 'bark',
    listRecipients(): Recipient[] {
      if (!isBarkChannelOn(readBarkSettings(settings))) return [];
      return devices
        .list()
        .filter((d) => d.enabled)
        .map((d) => ({ id: d.id, label: d.label }));
    },
    unavailableReason: (id) => deviceUnavailableReason(readBarkSettings(settings), devices.get(id)),
    async send(id, message) {
      const s = readBarkSettings(settings);
      const device = devices.get(id);
      const reason = deviceUnavailableReason(s, device);
      if (reason || !device) throw new ProviderError(reason ?? '设备已删除');
      await sendBark({ serverUrl: s.serverUrl, deviceKey: device.deviceKey }, message, fetchImpl);
    },
  };
}

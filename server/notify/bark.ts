import type { BarkSettingsView } from '../../shared/types.js';
import { isHttpUrl } from '../lib/validation.js';
import type { SettingsRepo } from '../repos/misc.js';
import { ProviderError, type NotificationProvider, type PushMessage } from './types.js';

export interface BarkSettings {
  enabled: boolean;
  serverUrl: string;
  deviceKey: string;
}

const SETTINGS_KEY = 'notify.bark';
export const DEFAULT_BARK_SERVER = 'https://api.day.app';
const TIMEOUT_MS = 10_000;

export function readBarkSettings(settings: SettingsRepo): BarkSettings {
  const stored = settings.get<Partial<BarkSettings>>(SETTINGS_KEY) ?? {};
  return {
    enabled: stored.enabled === true,
    serverUrl: typeof stored.serverUrl === 'string' && stored.serverUrl ? stored.serverUrl : DEFAULT_BARK_SERVER,
    deviceKey: typeof stored.deviceKey === 'string' ? stored.deviceKey : '',
  };
}

export function writeBarkSettings(settings: SettingsRepo, value: BarkSettings, now: Date): void {
  settings.set(SETTINGS_KEY, value, now);
}

export function isBarkConfigured(s: BarkSettings): boolean {
  return s.enabled && s.deviceKey.length > 0 && isHttpUrl(s.serverUrl);
}

export function maskKey(key: string): string | null {
  if (!key) return null;
  if (key.length <= 6) return '•'.repeat(key.length);
  return `${key.slice(0, 2)}${'•'.repeat(Math.min(12, key.length - 4))}${key.slice(-2)}`;
}

export function barkSettingsView(s: BarkSettings): BarkSettingsView {
  return {
    enabled: s.enabled,
    serverUrl: s.serverUrl,
    deviceKeyMasked: maskKey(s.deviceKey),
    configured: isBarkConfigured(s),
  };
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Remove the device key from any text that might be logged or shown. */
function scrub(text: string, key: string): string {
  return key ? text.split(key).join('***') : text;
}

export async function sendBark(s: BarkSettings, message: PushMessage, fetchImpl: FetchLike = fetch): Promise<void> {
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

export function createBarkProvider(settings: SettingsRepo, fetchImpl?: FetchLike): NotificationProvider {
  return {
    name: 'bark',
    isConfigured: () => isBarkConfigured(readBarkSettings(settings)),
    send: (message) => sendBark(readBarkSettings(settings), message, fetchImpl),
  };
}

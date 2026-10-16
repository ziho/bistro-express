import { Hono } from 'hono';
import { BARK_LIMITS } from '../../../shared/constants.js';
import type { BarkTestResult } from '../../../shared/types.js';
import { badRequest, conflict, HttpError, notFound } from '../../lib/errors.js';
import {
  barkDeviceCreateSchema,
  barkDeviceUpdateSchema,
  barkSettingsSchema,
  parseWith,
  UUID_RE,
} from '../../lib/validation.js';
import {
  barkSettingsView,
  isBarkChannelOn,
  normalizeDeviceKey,
  readBarkSettings,
  sendBark,
  writeBarkSettings,
} from '../../notify/bark.js';
import { LEGACY_DEVICE_LABEL } from '../../db/migrations.js';
import { PUSH_GROUP } from '../../notify/message.js';
import { ProviderError } from '../../notify/types.js';
import type { BarkDevice } from '../../repos/barkDevices.js';
import { ok, readJson } from '../helpers.js';
import type { Ctx, HonoEnv } from '../types.js';

function view(c: Ctx) {
  const { settings, barkDevices } = c.get('app').repos;
  return barkSettingsView(readBarkSettings(settings), barkDevices.list());
}

function deviceKeyOrThrow(raw: string): string {
  const key = normalizeDeviceKey(raw);
  if (!key) throw badRequest('设备 Key 格式不正确（只包含字母、数字、- 或 _）', { field: 'deviceKey' });
  return key;
}

function ensureUniqueKey(c: Ctx, key: string, selfId: string | null) {
  const existing = c.get('app').repos.barkDevices.findByKey(key);
  if (existing && existing.id !== selfId) {
    throw conflict('duplicate_device', `这个设备 Key 已经添加过了（${existing.label}）`, { field: 'deviceKey' });
  }
}

function addDevice(c: Ctx, rec: { label: string; deviceKey: string; enabled: boolean }): BarkDevice {
  const app = c.get('app');
  if (app.repos.barkDevices.count() >= BARK_LIMITS.maxDevices) {
    throw conflict('too_many_devices', `最多添加 ${BARK_LIMITS.maxDevices} 台设备`);
  }
  ensureUniqueKey(c, rec.deviceKey, null);
  return app.repos.barkDevices.insert(rec, app.clock());
}

function deviceParam(c: Ctx): BarkDevice {
  const id = c.req.param('id') ?? '';
  const device = UUID_RE.test(id) ? c.get('app').repos.barkDevices.get(id) : null;
  if (!device) throw notFound('这台设备不存在');
  return device;
}

const TEST_MESSAGE = {
  title: 'Bistro Express 测试推送',
  body: '如果你看到这条消息，说明这台设备已接通。',
  group: PUSH_GROUP,
};

async function testDevice(c: Ctx, device: BarkDevice): Promise<BarkTestResult> {
  const app = c.get('app');
  const { serverUrl } = readBarkSettings(app.repos.settings);
  try {
    await sendBark(
      { serverUrl, deviceKey: device.deviceKey },
      { ...TEST_MESSAGE, url: app.config.publicBaseUrl },
      app.outboundFetch,
    );
    return { id: device.id, label: device.label, ok: true, error: null };
  } catch (err) {
    return { id: device.id, label: device.label, ok: false, error: err instanceof ProviderError ? err.message : '发送失败' };
  }
}

/** Admin-only Bark settings. Raw device keys are accepted on write and never returned. */
export function barkSettingsRoutes() {
  const r = new Hono<HonoEnv>();

  r.get('/settings/bark', (c) => ok(c, view(c)));

  r.put('/settings/bark', async (c) => {
    const app = c.get('app');
    const input = parseWith(barkSettingsSchema, (await readJson(c)).value);
    app.db.transaction(() => {
      const serverUrl = input.serverUrl.replace(/\/+$/, '');
      writeBarkSettings(app.repos.settings, { enabled: input.enabled, serverUrl }, app.clock());
      if (input.deviceKey) {
        const key = deviceKeyOrThrow(input.deviceKey);
        if (!app.repos.barkDevices.findByKey(key)) addDevice(c, { label: LEGACY_DEVICE_LABEL, deviceKey: key, enabled: true });
      }
    })();
    return ok(c, view(c));
  });

  /** Sends a test to every enabled device; each result is reported separately. */
  r.post('/settings/bark/test', async (c) => {
    const app = c.get('app');
    const s = readBarkSettings(app.repos.settings);
    const devices = app.repos.barkDevices.list().filter((d) => d.enabled);
    if (!isBarkChannelOn(s) || devices.length === 0) throw conflict('unconfigured', 'Bark 还未启用，或没有启用的设备');
    const results: BarkTestResult[] = [];
    // Bounded concurrency keeps worst-case tests under the proxy timeout.
    for (let offset = 0; offset < devices.length; offset += 4) {
      results.push(...await Promise.all(devices.slice(offset, offset + 4).map((device) => testDevice(c, device))));
    }
    return ok(c, { accepted: results.every((x) => x.ok), results });
  });

  r.post('/settings/bark/devices', async (c) => {
    const input = parseWith(barkDeviceCreateSchema, (await readJson(c)).value);
    addDevice(c, { label: input.label, deviceKey: deviceKeyOrThrow(input.deviceKey), enabled: input.enabled });
    return ok(c, view(c), 201);
  });

  r.patch('/settings/bark/devices/:id', async (c) => {
    const app = c.get('app');
    const device = deviceParam(c);
    const input = parseWith(barkDeviceUpdateSchema, (await readJson(c)).value);
    const deviceKey = input.deviceKey ? deviceKeyOrThrow(input.deviceKey) : device.deviceKey;
    ensureUniqueKey(c, deviceKey, device.id);
    app.repos.barkDevices.update(
      device.id,
      { label: input.label ?? device.label, deviceKey, enabled: input.enabled ?? device.enabled },
      app.clock(),
    );
    return ok(c, view(c));
  });

  r.delete('/settings/bark/devices/:id', (c) => {
    c.get('app').repos.barkDevices.remove(deviceParam(c).id);
    return ok(c, view(c));
  });

  /** Explicit admin action: works even while the device or the global switch is off. */
  r.post('/settings/bark/devices/:id/test', async (c) => {
    const result = await testDevice(c, deviceParam(c));
    if (!result.ok) throw new HttpError(502, 'provider_error', result.error ?? '发送失败');
    return ok(c, { accepted: true });
  });

  return r;
}

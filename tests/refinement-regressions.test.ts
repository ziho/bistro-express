import { afterEach, describe, expect, it } from 'vitest';
import { classifyMapsUrl, parseMapsUrl } from '../server/maps/parse.js';
import { extractLink } from '../server/maps/resolve.js';
import { createTestEnv, homePlan, idem, seedDish, type TestEnv } from './helpers.js';

describe('map link import regressions', () => {
  it('keeps plus signs and literal percent encoding in already-decoded query names', () => {
    const u = new URL('https://www.google.com/maps/search/');
    u.searchParams.set('query', 'C++ Cafe 100%25');
    expect(parseMapsUrl(u).name).toBe('C++ Cafe 100%25');
  });

  it('does not treat arbitrary google.country-looking domains as trusted Google hosts', () => {
    expect(classifyMapsUrl('https://maps.google.zz/maps')).toMatchObject({ ok: false });
    expect(classifyMapsUrl('https://maps.google.co.zz/maps')).toMatchObject({ ok: false });
    expect(classifyMapsUrl('https://www.google.ca/maps/place/Cafe')).toMatchObject({ ok: true });
  });

  it('preserves balanced parentheses in real map URLs while dropping a Markdown wrapper', () => {
    const url = 'https://www.google.com/maps/place/Cafe+(Richmond)/@49,-123,15z';
    expect(extractLink(url)).toBe(url);
    expect(extractLink('[map](' + url + ')')).toBe(url);
    expect(extractLink('[' + url + '](' + url + ')')).toBe(url);
  });
});

describe('recipient reactivation regression', () => {
  let env: TestEnv | undefined;
  afterEach(async () => { await env?.cleanup(); env = undefined; });

  it('can retry on a re-enabled original device after unsuccessful replacement targets', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const guest = await env.guest();
    env.provider.devices = [{ id: 'device-a', label: 'A', enabled: true, failures: 1 }];
    const dish = await seedDish(admin, '重试测试菜');
    const created = await guest.post('/bistro/api/plans', homePlan([dish.id]), idem());
    expect(created.status).toBe(201);
    const planId = created.body.data.id;
    const latest = async () => (await guest.get('/bistro/api/plans/' + planId)).body.data.notification;
    await env.ctx.worker.drain(); // A fails.
    env.provider.devices[0]!.enabled = false;
    env.provider.devices.push({ id: 'device-b', label: 'B', enabled: true, failures: 1 });
    env.advance(31_000);
    await env.ctx.worker.drain(); // A becomes skipped.
    const notificationId = (await latest()).id;
    expect((await admin.post('/bistro/api/admin/notifications/' + notificationId + '/retry')).status).toBe(200);
    await env.ctx.worker.drain(); // B fails, A is retired.
    env.provider.devices[0]!.enabled = true;
    env.provider.devices[1]!.enabled = false;
    env.advance(31_000);
    await env.ctx.worker.drain(); // B becomes skipped.
    expect((await admin.post('/bistro/api/admin/notifications/' + notificationId + '/retry')).status).toBe(200);
    await env.ctx.worker.drain(); // A must reactivate and receive once.
    expect(env.provider.sentTo.map((s) => s.device)).toEqual(['device-a']);
    expect(await latest()).toMatchObject({ status: 'sent', delivery: { total: 1, sent: 1 } });
  });
});

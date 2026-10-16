import type { FetchLike } from '../server/notify/bark.js';

/** Fake Bark `/push` endpoint keyed by device key. Never touches the network. */
export function createFakeBark() {
  const received: { key: string; title: string; body: string; url: string }[] = [];
  /** device key → remaining failures (use Infinity for "always down"). */
  const failing = new Map<string, number>();

  const fetch: FetchLike = async (url, init) => {
    if (!url.endsWith('/push')) throw new Error(`unexpected request in fake Bark: ${url}`);
    const body = JSON.parse(String(init.body)) as { device_key: string; title: string; body: string; url: string };
    const remaining = failing.get(body.device_key) ?? 0;
    if (remaining > 0) {
      failing.set(body.device_key, remaining - 1);
      // Echo the key back like a careless server would, to prove it gets scrubbed.
      return new Response(JSON.stringify({ code: 400, message: `device ${body.device_key} unreachable` }), { status: 400 });
    }
    received.push({ key: body.device_key, title: body.title, body: body.body, url: body.url });
    return new Response(JSON.stringify({ code: 200, message: 'success' }), { status: 200 });
  };

  return {
    fetch,
    received,
    failing,
    countFor: (key: string) => received.filter((r) => r.key === key).length,
  };
}

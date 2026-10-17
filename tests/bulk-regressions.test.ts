import { afterEach, describe, expect, it, vi } from 'vitest';
import { BULK_IMPORT, MAP_LINK_INPUT_MAX } from '../shared/constants';
import { loadBulkDraft } from '../web/src/lib/bulkDraft';
import {
  analyzeQueue, countQueue, editRow, newRow, nextToResolve, parsePaste, rowKeys, rowProblems,
  tagProblems, type QueueRow, type QueueState,
} from '../web/src/lib/bulkQueue';
import { createTestEnv, idem, type TestEnv } from './helpers';

const original = 'https://www.google.com/maps/place/Original?cid=11';
const replacement = 'https://www.google.com/maps/place/Replacement?cid=22';
function ready(id: string): QueueRow {
  return {
    ...newRow(original, id), name: 'Original', mapUrl: original, status: 'resolved',
    autofilled: { name: 'Original', mapUrl: original },
    preview: { resolvedUrl: original, mapUrl: original, expanded: false, nameSource: 'place', hasPlace: false },
  };
}
const state = (rows: QueueRow[]): QueueState => ({ rows, pendingCommit: null });
let env: TestEnv | undefined;
afterEach(() => { env?.cleanup(); env = undefined; vi.unstubAllGlobals(); });

describe('bulk import review regressions', () => {
  it('rechecks a changed source without carrying the previous place identity or untouched auto fields', () => {
    const changed = editRow(ready('row-a'), { sourceUrl: replacement });
    expect(changed.status).toBe('edited');
    expect(changed.preview).toBeNull();
    expect(changed.name).toBe('');
    expect(changed.mapUrl).toBe('');
    expect(rowKeys(changed).has('cid:11')).toBe(false);
    expect(rowKeys(changed).has('cid:22')).toBe(true);
    const custom = editRow({ ...ready('row-b'), name: '我的名字', tags: '约会' }, { sourceUrl: replacement });
    expect(custom.name).toBe('我的名字');
    expect(custom.tags).toBe('约会');
  });

  it('checks an edited destination as its own link instead of matching the old preview', () => {
    const changed = editRow(ready('row-a'), { mapUrl: replacement });
    expect(changed.sourceUrl).toBe(replacement);
    expect(changed.preview).toBeNull();
    expect(changed.status).toBe('edited');
    expect(rowKeys(changed).has('cid:11')).toBe(false);
    expect(rowKeys(changed).has('cid:22')).toBe(true);
  });

  it('finishes the queue when its only remaining queued row is a duplicate', () => {
    const s = state([ready('first'), newRow(original, 'copy')]);
    const info = analyzeQueue(s, []);
    expect(countQueue(s, info)).toMatchObject({ waiting: 0, duplicates: 1, importable: 1 });
    expect(nextToResolve(s, info, new Set(), 2)).toEqual([]);
    const incomplete = state([{ ...ready('missing-name'), name: '' }]);
    expect(countQueue(incomplete, analyzeQueue(incomplete, [])).needsAttention).toBe(1);
  });

  it('uses the same string limits as the server for multibyte names and tags', () => {
    expect(rowProblems({ ...ready('emoji'), name: '🍜'.repeat(31) }).map(p => p.message).join()).toContain('店名');
    expect(tagProblems(['🍜'.repeat(9)]).join()).toContain('标签');
  });

  it('rejects an overlong line without consuming or truncating the pasted input', () => {
    const long = 'https://maps.app.goo.gl/' + 'x'.repeat(MAP_LINK_INPUT_MAX);
    const text = original + '\n' + long;
    const current = [ready('existing')];
    const result = parsePaste(text, current, () => 'new-row');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('第 2 行');
    expect(current).toHaveLength(1);
    expect(text.endsWith(long)).toBe(true);
  });

  it('continues without a draft when the browser refuses storage operations', () => {
    vi.stubGlobal('window', { sessionStorage: { getItem() { throw new Error('Storage blocked'); } } });
    expect(() => loadBulkDraft()).not.toThrow();
    expect(loadBulkDraft()).toEqual({ state: null, discarded: false });
  });

  it('accepts a valid 100-row UTF-8 batch larger than 512KiB on the private import route', async () => {
    env = await createTestEnv();
    const admin = await env.admin();
    const rows = Array.from({ length: BULK_IMPORT.maxRows }, (_,i) => ({
      clientId: 'row-' + i,
      name: '店'.repeat(60),
      mapUrl: 'https://www.google.com/maps/place/Branch-' + i + '?cid=' + (i + 100),
      sourceUrl: 'https://www.google.com/maps/place/' + '源'.repeat(1900) + i,
      tags: Array.from({ length: 12 }, (_,t) => '标'.repeat(14) + t),
    }));
    const bytes = Buffer.byteLength(JSON.stringify({ rows }));
    expect(bytes).toBeGreaterThan(512 * 1024);
    expect(bytes).toBeLessThan(BULK_IMPORT.requestBytes);
    const res = await admin.post('/bistro/api/admin/restaurants/import', { rows }, idem());
    expect(res.status, res.text).toBe(200);
    expect(res.body.data).toMatchObject({ created: 100, duplicates: 0, errors: 0 });
    expect(env.ctx.repos.catalog.listRestaurants(false)).toHaveLength(100);
  });
});

import { describe, expect, it } from 'vitest';
import { BULK_IMPORT, LIMITS, MAP_LINK_INPUT_MAX } from '../shared/constants.js';
import type { MapLinkPreview, Restaurant, RestaurantImportResponse } from '../shared/types.js';
import { parseBulkDraft, serializeBulkDraft } from '../web/src/lib/bulkDraft.js';
import {
  addTagsToSelected,
  analyzeQueue,
  applyCommitResults,
  applyFailure,
  applyPreview,
  buildPendingCommit,
  commitRows,
  countQueue,
  editRow,
  markResolving,
  nextToResolve,
  parsePaste,
  requeue,
  retryRow,
  selectImportable,
  setManual,
  type QueueRow,
  type QueueState,
} from '../web/src/lib/bulkQueue.js';

const SHORT_A = 'https://maps.app.goo.gl/9f4aKWUmFPaMDfNe6';
const SHORT_B = 'https://maps.app.goo.gl/AnotherLink42';
const KATSU =
  'https://www.google.com/maps/place/Katsu+San+Richmond/@49.1953668,-123.1098036,13z/data=!4m6!3m5!1s0x54860baf877a0bfd:0xbbeb7dc28fc54b8a!8m2!3d49.1699676!4d-123.1818262!16s%2Fg%2F11jgc9682c';
const KATSU_OTHER_BRANCH = 'https://www.google.com/maps/place/Katsu+San+Richmond/data=!4m2!3m1!1s0x5486000000000001:0x1234567890abcdef';
const DEER = 'https://www.google.com/maps/place/Deer+Garden/data=!4m2!3m1!1s0x5486753000a08ef7:0xd8c9468b997714a3';

let n = 0;
const ids = () => `row-${(n += 1)}`;
const state = (rows: QueueRow[], pendingCommit: QueueState['pendingCommit'] = null): QueueState => ({ rows, pendingCommit });

function paste(text: string, current: QueueRow[] = []): QueueRow[] {
  const result = parsePaste(text, current, ids);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}

function preview(sourceUrl: string, resolvedUrl: string, name: string | null): MapLinkPreview {
  return {
    sourceUrl,
    resolvedUrl,
    mapUrl: resolvedUrl,
    expanded: sourceUrl !== resolvedUrl,
    name,
    nameSource: name ? 'place' : null,
    nameTruncated: false,
    place: null,
    camera: null,
    identifiers: { placeId: null, ftid: null, cid: null, cidDerived: false, kgId: null },
    duplicates: [],
    notes: [],
  };
}

/** Runs a row through markResolving + applyPreview, as the queue runner does. */
const resolved = (row: QueueRow, resolvedUrl: string, name: string | null = 'Katsu San Richmond') =>
  applyPreview(markResolving(row), row.sourceUrl, preview(row.sourceUrl, resolvedUrl, name));

const restaurant = (id: string, name: string, mapUrl: string | null, active = true): Restaurant => ({
  id,
  name,
  imageAssetId: null,
  review: '',
  tags: [],
  budgetText: '',
  address: '',
  mapUrl,
  links: [],
  note: '',
  active,
  createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z',
});

describe('bulk import paste', () => {
  it('keeps one row per non-blank line, extracts links from share text and keeps invalid lines with a reason', () => {
    const rows = paste(['', `Katsu San Richmond ${SHORT_A}`, '   ', 'no link here', 'http://maps.app.goo.gl/abcd1', 'https://evil.example/maps/place/x', KATSU].join('\n'));
    expect(rows.map((r) => [r.status, r.sourceUrl])).toEqual([
      ['queued', SHORT_A],
      ['failed', ''],
      ['failed', 'http://maps.app.goo.gl/abcd1'],
      ['failed', 'https://evil.example/maps/place/x'],
      ['queued', KATSU],
    ]);
    expect(rows[1]!.error).toContain('没有找到链接');
    expect(rows[2]!.error).toContain('https');
    expect(rows[3]!.error).toContain('Google 地图');
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('rejects too many lines, too much text and over-long lines as a whole instead of truncating', () => {
    const many = Array.from({ length: BULK_IMPORT.maxRows + 1 }, (_, i) => `${SHORT_A}${i}`).join('\n');
    expect(parsePaste(many, [], ids)).toMatchObject({ ok: false, error: expect.stringContaining(`${BULK_IMPORT.maxRows + 1} 行`) });
    expect(parsePaste('x'.repeat(BULK_IMPORT.maxPasteChars + 1), [], ids).ok).toBe(false);
    expect(parsePaste(`${KATSU}?q=${'y'.repeat(MAP_LINK_INPUT_MAX)}`, [], ids).ok).toBe(false);
    expect(parsePaste('\n \n', [], ids).ok).toBe(false);
  });

  it('appending counts the rows still waiting in the queue but not imported ones', () => {
    const existing = paste(Array.from({ length: 60 }, (_, i) => `https://maps.app.goo.gl/link${i}`).join('\n'));
    expect(parsePaste(Array.from({ length: 41 }, (_, i) => `https://maps.app.goo.gl/more${i}`).join('\n'), existing, ids).ok).toBe(false);
    const imported = existing.map((r) => ({ ...r, status: 'imported' as const, imported: { id: r.id, name: 'x' } }));
    const more = parsePaste(Array.from({ length: 41 }, (_, i) => `https://maps.app.goo.gl/more${i}`).join('\n'), imported, ids);
    expect(more.ok).toBe(true);
  });
});

describe('bulk import preview merge and retry', () => {
  it('fills only empty or untouched auto fields and never touches tags', () => {
    const [row] = paste(SHORT_A);
    const first = resolved({ ...row!, tags: '炸物' }, KATSU);
    expect(first).toMatchObject({ status: 'resolved', name: 'Katsu San Richmond', mapUrl: KATSU, tags: '炸物' });

    // Retrying after the admin renamed it keeps their name; an untouched name follows the new preview.
    const renamed = editRow(first, { name: '我起的名字' });
    const again = resolved(retryRow(renamed), KATSU, 'Katsu San (new)');
    expect(again.name).toBe('我起的名字');
    const untouched = resolved(retryRow(first), KATSU, 'Katsu San (new)');
    expect(untouched.name).toBe('Katsu San (new)');
    expect(untouched.tags).toBe('炸物');
  });

  it('drops answers for a link that was edited or removed meanwhile, and requeues on 429', () => {
    const [row] = paste(SHORT_A);
    const busy = markResolving(row!);
    const edited = editRow(busy, { sourceUrl: SHORT_B });
    expect(edited.status).toBe('edited');
    expect(applyPreview(edited, SHORT_A, preview(SHORT_A, KATSU, 'Katsu'))).toBe(edited);
    expect(applyFailure(edited, SHORT_A, 'boom')).toBe(edited);
    expect(requeue(busy, SHORT_A).status).toBe('queued');
    expect(applyFailure(busy, SHORT_A, '短链接已失效')).toMatchObject({ status: 'failed', error: '短链接已失效' });
  });

  it('retries a corrected source, and re-checks it locally before sending', () => {
    const [bad] = paste('https://evil.example/maps/place/x');
    expect(retryRow(bad!).status).toBe('failed');
    const fixed = editRow(bad!, { sourceUrl: SHORT_A });
    expect(retryRow(fixed)).toMatchObject({ status: 'queued', error: null });
  });

  it('allows a failed strict link to be used manually only after an explicit choice and a name', () => {
    const [row] = paste(SHORT_A);
    const failed = applyFailure(markResolving(row!), SHORT_A, '暂时连不上');
    const info = (r: QueueRow) => analyzeQueue(state([r]), []).get(r.id)!;
    expect(info(failed)).toMatchObject({ canManual: true, importable: false });
    const manual = setManual(editRow(failed, { name: '手动店名' }), true);
    expect(manual.mapUrl).toBe(SHORT_A);
    expect(info(manual).importable).toBe(true);
    expect(info(setManual(manual, false)).importable).toBe(false);
    const [invalid] = paste('https://evil.example/maps/place/x');
    expect(info(invalid!).canManual).toBe(false);
  });
});

describe('bulk import duplicates and selection', () => {
  it('detects queue duplicates by link and place id (never by name) and keeps references right after removal', () => {
    const rows = paste([SHORT_A, SHORT_A, SHORT_B, DEER].join('\n'));
    let s = state(rows);
    let info = analyzeQueue(s, []);
    expect(info.get(rows[1]!.id)!.queueDuplicateOf).toEqual({ id: rows[0]!.id, index: 1 });
    // The copy is never previewed; only the first two distinct links start (max 2 at a time).
    expect(nextToResolve(s, info, new Set(), BULK_IMPORT.resolveConcurrency).map((r) => r.id)).toEqual([rows[0]!.id, rows[2]!.id]);

    // Two different short links resolving to the same place are the same branch.
    s = state([resolved(rows[0]!, KATSU), rows[1]!, resolved(rows[2]!, `${KATSU}?entry=tts`), rows[3]!]);
    info = analyzeQueue(s, []);
    expect(info.get(rows[2]!.id)!.queueDuplicateOf?.index).toBe(1);
    expect(info.get(rows[2]!.id)!.importable).toBe(false);

    // Remove the first row: the old copy now stands on its own, numbering follows the new order.
    s = state(s.rows.slice(1));
    info = analyzeQueue(s, []);
    expect(info.get(rows[1]!.id)).toMatchObject({ index: 1, queueDuplicateOf: null });
    expect(info.get(rows[2]!.id)!.queueDuplicateOf).toBeNull(); // SHORT_B ≠ SHORT_A without the first row's preview
  });

  it('does not treat another branch or a same-name restaurant as duplicate', () => {
    const [a, b] = paste([KATSU, KATSU_OTHER_BRANCH].join('\n'));
    const s = state([resolved(a!, KATSU), resolved(b!, KATSU_OTHER_BRANCH)]);
    const info = analyzeQueue(s, [restaurant('r1', 'Katsu San Richmond', DEER)]);
    expect([...info.values()].map((i) => [i.queueDuplicateOf, i.existing.length, i.importable])).toEqual([
      [null, 0, true],
      [null, 0, true],
    ]);
  });

  it('skips rows matching existing restaurants, inactive ones included, and shows their names', () => {
    const [a, b, c] = paste([SHORT_A, DEER, SHORT_B].join('\n'));
    const list = [restaurant('old', '旧短链接', SHORT_A), restaurant('off', '已下架', `${DEER}?hl=en`, false)];
    const s = state([resolved(a!, KATSU), resolved(b!, DEER, 'Deer'), resolved(c!, KATSU_OTHER_BRANCH)]);
    const info = analyzeQueue(s, list);
    expect(info.get(a!.id)).toMatchObject({ importable: false, existing: [{ id: 'old', name: '旧短链接' }] });
    expect(info.get(b!.id)).toMatchObject({ importable: false, existing: [{ id: 'off', active: false }] });
    expect(info.get(c!.id)!.importable).toBe(true);
    // Not loaded yet: nothing can be imported blind.
    expect(analyzeQueue(s, null).get(c!.id)!.importable).toBe(false);
    expect(countQueue(s, info)).toMatchObject({ total: 3, duplicates: 2, importable: 1, selected: 1 });
  });

  it('selects only valid non-duplicates and validates fields like the normal form', () => {
    const [a, b, c] = paste([KATSU, DEER, SHORT_B].join('\n'));
    const rows = [
      resolved(a!, KATSU),
      editRow(resolved(b!, DEER, 'Deer'), { name: '名'.repeat(LIMITS.name + 1) }),
      resolved(c!, KATSU_OTHER_BRANCH, null),
    ];
    let s = state(selectImportable(rows, analyzeQueue(state(rows), []), false));
    let info = analyzeQueue(s, []);
    expect(countQueue(s, info).selected).toBe(0);
    expect(info.get(b!.id)!.problems).toEqual([{ field: 'name', message: expect.stringContaining(`${LIMITS.name}`) }]);
    expect(info.get(c!.id)!.problems.map((p) => p.field)).toEqual(['name']);
    s = state(selectImportable(s.rows, info, true));
    info = analyzeQueue(s, []);
    expect(commitRows(s, info).map((r) => r.clientId)).toEqual([a!.id]);
  });
});

describe('bulk import batch tags', () => {
  it('adds the union to selected rows only, skips rows that would exceed the limit, and validates input', () => {
    const [a, b, c] = paste([KATSU, DEER, KATSU_OTHER_BRANCH].join('\n'));
    const full = Array.from({ length: LIMITS.restaurantTags }, (_, i) => `t${i}`).join(' ');
    const rows = [
      editRow(resolved(a!, KATSU), { tags: '川菜 约会' }),
      editRow(resolved(b!, DEER, 'Deer'), { tags: full }),
      { ...resolved(c!, KATSU_OTHER_BRANCH, 'Other'), selected: false },
    ];
    const info = analyzeQueue(state(rows), []);
    const result = addTagsToSelected(rows, info, '约会，火锅 #夜宵');
    expect(result).toMatchObject({ ok: true, applied: 1, skipped: 1 });
    if (!result.ok) return;
    expect(result.rows.map((r) => r.tags)).toEqual(['川菜 约会 火锅 夜宵', full, '']);
    expect(addTagsToSelected(rows, info, '长'.repeat(LIMITS.tag + 1))).toMatchObject({ ok: false });
    expect(addTagsToSelected(rows, info, '  ')).toMatchObject({ ok: false });
    expect(addTagsToSelected(rows, new Map(), '火锅')).toMatchObject({ ok: false });
  });
});

describe('bulk import commit results', () => {
  it('locks submitted rows, marks created rows read-only and keeps the rest editable for another try', () => {
    const [a, b, c] = paste([KATSU, DEER, KATSU_OTHER_BRANCH].join('\n'));
    const rows = [resolved(a!, KATSU), resolved(b!, DEER, 'Deer'), resolved(c!, KATSU_OTHER_BRANCH, 'Other')];
    const s0 = state(rows);
    const payload = commitRows(s0, analyzeQueue(s0, []));
    expect(payload.map((r) => r.clientId)).toEqual(rows.map((r) => r.id));
    expect(payload[0]).toEqual({
      clientId: a!.id,
      name: 'Katsu San Richmond',
      mapUrl: KATSU,
      sourceUrl: KATSU,
      tags: [],
      location: { country: '', countryCode: '', region: '', city: '', source: '' },
      purposes: ['meal'],
    });
    const pending = buildPendingCommit(payload, 'idem-key-123');
    expect(JSON.parse(pending.body)).toEqual({ rows: payload });

    // While unanswered, the rows cannot be selected for a second submission.
    const locked = state(rows, pending);
    expect(commitRows(locked, analyzeQueue(locked, []))).toEqual([]);

    const response: RestaurantImportResponse = {
      results: [
        { clientId: a!.id, status: 'created', restaurant: { id: 'new-1', name: 'Katsu San Richmond' } },
        { clientId: b!.id, status: 'duplicate', message: '已有相同地点的餐厅，已跳过', duplicates: [{ id: 'x', name: 'Deer', active: true, matchedBy: ['FTID'] }] },
        { clientId: c!.id, status: 'error', message: '请填写餐厅名', field: 'name' },
      ],
      created: 1,
      duplicates: 1,
      errors: 1,
      replayed: false,
    };
    const after = state(applyCommitResults(rows, response));
    const [created, dup, err] = after.rows;
    expect(created).toMatchObject({ status: 'imported', imported: { id: 'new-1' }, selected: false });
    expect(editRow(created!, { name: 'changed' })).toBe(created);
    expect(dup!.commit?.kind).toBe('duplicate');
    expect(err!.commit).toEqual({ kind: 'error', message: '请填写餐厅名' });
    let info = analyzeQueue(after, []);
    expect(commitRows(after, info)).toEqual([]); // nothing is sent twice
    expect(countQueue(after, info)).toMatchObject({ imported: 1, duplicates: 1, needsAttention: 1 });

    // Editing the failed row clears the server verdict, so it can be selected again.
    const fixed = state([created!, dup!, editRow(err!, { name: 'Other 2' })]);
    info = analyzeQueue(fixed, []);
    expect(commitRows(fixed, info).map((r) => r.clientId)).toEqual([c!.id]);
    // The imported row still anchors queue duplicates until the list is refreshed.
    const [copy] = paste(KATSU);
    const withCopy = state([...fixed.rows, resolved(copy!, KATSU)]);
    expect(analyzeQueue(withCopy, []).get(copy!.id)!.queueDuplicateOf?.index).toBe(1);
    // After the refresh it is reported once, as an existing restaurant.
    const refreshed = analyzeQueue(withCopy, [restaurant('new-1', 'Katsu San Richmond', KATSU)]).get(copy!.id)!;
    expect(refreshed).toMatchObject({ queueDuplicateOf: null, existing: [{ id: 'new-1' }] });
  });
});

describe('bulk import tab draft', () => {
  it('round-trips the queue and resumes interrupted previews as waiting', () => {
    const rows = paste([SHORT_A, 'no link'].join('\n'));
    const s = state([markResolving(rows[0]!), rows[1]!], buildPendingCommit([], 'idem-key-123'));
    const back = parseBulkDraft(serializeBulkDraft(s))!;
    expect(back.rows[0]!.status).toBe('queued');
    expect(back.rows[1]).toEqual(rows[1]);
    expect(back.pendingCommit).toEqual(s.pendingCommit);
  });

  it('discards drafts of another version, malformed shape or absurd size', () => {
    const [row] = paste(SHORT_A);
    const good = JSON.parse(serializeBulkDraft(state([row!])));
    const variants: unknown[] = [
      { ...good, version: 99 },
      { ...good, rows: 'nope' },
      { ...good, rows: [{ ...row, id: 'bad id!' }] },
      { ...good, rows: [{ ...row, status: 'exploded' }] },
      { ...good, rows: [{ ...row, name: 'x'.repeat(100_000) }] },
      { ...good, rows: [row, row] },
      { ...good, rows: [{ ...row, status: 'imported', imported: null }] },
      { ...good, pendingCommit: { key: 'idem-key-123', body: '{}', rowIds: ['unknown'] } },
      { ...good, rows: Array.from({ length: BULK_IMPORT.maxQueue + 1 }, (_, i) => ({ ...row, id: `r${i}` })) },
    ];
    for (const v of variants) expect(parseBulkDraft(JSON.stringify(v))).toBeNull();
    expect(parseBulkDraft('{not json')).toBeNull();
    expect(parseBulkDraft(null)).toBeNull();
    expect(parseBulkDraft(JSON.stringify(good))).not.toBeNull();
  });
});

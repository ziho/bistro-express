import { describe, expect, it } from 'vitest';
import { parseRestaurantCreate, parseRestaurantUpdate, parseTreatTypes } from '../server/lib/restaurantValidation.js';
import {
  inferTreatTypes,
  matchesTreatTypes,
  readStoredTreatTypes,
  treatTypeChoices,
  UNCLASSIFIED_TREAT,
} from '../shared/treatType.js';
import type { MapLinkPreview, Restaurant, TreatType, VenuePurpose } from '../shared/types.js';
import { activeFilterCount, clearVenueCriteria, emptyVenueFilter, filterVenues, type VenueFilter } from '../shared/venueFilter.js';
import { BULK_DRAFT_VERSION, parseBulkDraft, serializeBulkDraft } from '../web/src/lib/bulkDraft.js';
import {
  analyzeQueue,
  applyPreview,
  commitRows,
  markResolving,
  parsePaste,
  setRowPurposes,
  setRowTreatTypes,
  setTreatTypesSelected,
  type QueueRow,
  type QueueState,
} from '../web/src/lib/bulkQueue.js';
import { parseRemembered } from '../web/src/lib/venueFilterStore.js';

const NOWHERE = { country: '', countryCode: '', region: '', city: '', source: '' } as const;

function venue(id: string, purposes: VenuePurpose[], treatTypes: TreatType[] = [], tags: string[] = []): Restaurant {
  return {
    id,
    name: id,
    imageAssetId: null,
    review: '',
    tags,
    budgetText: '',
    address: '',
    mapUrl: null,
    links: [],
    note: '',
    location: { ...NOWHERE },
    purposes,
    treatTypes,
    active: true,
    createdAt: '',
    updatedAt: '',
  };
}

describe('treat type inference', () => {
  it('only maps exact known tags (simplified / traditional / English, trimmed, case-insensitive)', () => {
    expect(inferTreatTypes(['奶茶'])).toEqual(['milk_tea']);
    expect(inferTreatTypes(['  咖啡館 ', 'Bubble Tea', '麵包', 'Gelato'])).toEqual(['milk_tea', 'coffee', 'ice_cream', 'bakery']);
    expect(inferTreatTypes(['糖水', '甜品', '蛋糕'])).toEqual(['tong_sui', 'cake']);
    // No substrings, no guesses, and 其他 is never inferred.
    expect(inferTreatTypes(['奶茶拿铁', '咖啡色', '面包蟹', '约会', '其他', 'coffee shop near'])).toEqual([]);
    expect(inferTreatTypes([])).toEqual([]);
  });

  it('reads stored values of any quality without guessing', () => {
    expect(readStoredTreatTypes(['cake', 'coffee', 'cake', 'bogus', 3])).toEqual(['coffee', 'cake']);
    expect(readStoredTreatTypes(undefined)).toEqual([]);
    expect(readStoredTreatTypes('coffee')).toEqual([]);
    expect(readStoredTreatTypes(null)).toEqual([]);
  });
});

describe('treat type validation', () => {
  const stored = { ...venue('s', ['treat'], ['coffee', 'cake'], ['咖啡']) };

  it('infers on create only for treat venues when omitted; explicit [] stays unclassified', () => {
    expect(parseRestaurantCreate({ name: 'a', tags: ['奶茶', '约会'], purposes: ['treat'] }).treatTypes).toEqual(['milk_tea']);
    expect(parseRestaurantCreate({ name: 'a', tags: ['奶茶'], purposes: ['meal'] }).treatTypes).toEqual([]);
    expect(parseRestaurantCreate({ name: 'a', tags: ['奶茶'] }).treatTypes).toEqual([]);
    expect(parseRestaurantCreate({ name: 'a', tags: ['奶茶'], purposes: ['treat'], treatTypes: [] }).treatTypes).toEqual([]);
    expect(parseRestaurantCreate({ name: 'a', purposes: ['meal', 'treat'], treatTypes: ['other', 'coffee', 'coffee'] }).treatTypes).toEqual([
      'coffee',
      'other',
    ]);
  });

  it('rejects unknown or malformed types instead of dropping them', () => {
    for (const bad of [['brunch'], 'coffee', [null], { 0: 'coffee' }, Array(20).fill('coffee')]) {
      expect(() => parseTreatTypes(bad, null, { purposes: ['treat'], tags: [] })).toThrow();
    }
    expect(() => parseRestaurantUpdate({ name: 's', treatTypes: ['tea'] }, stored)).toThrow();
  });

  it('an update without types keeps them (older pages), [] clears, and meal-only keeps them for later', () => {
    expect(parseRestaurantUpdate({ name: 's', tags: ['奶茶'] }, stored).treatTypes).toEqual(['coffee', 'cake']);
    expect(parseRestaurantUpdate({ name: 's', treatTypes: [] }, stored).treatTypes).toEqual([]);
    expect(parseRestaurantUpdate({ name: 's', purposes: ['meal'] }, stored)).toMatchObject({ purposes: ['meal'], treatTypes: ['coffee', 'cake'] });
    // Never re-inferred on update, even when tags now name a type.
    const untyped = { ...stored, treatTypes: [] };
    expect(parseRestaurantUpdate({ name: 's', tags: ['奶茶'] }, untyped).treatTypes).toEqual([]);
  });
});

describe('treat type filter', () => {
  const VENUES = [
    venue('tea', ['treat'], ['milk_tea']),
    venue('teaCake', ['treat'], ['milk_tea', 'cake']),
    venue('coffeeBoth', ['meal', 'treat'], ['coffee']),
    venue('untyped', ['treat'], []),
    // Meal-only venue keeps its old types, but they never apply.
    venue('mealKept', ['meal'], ['milk_tea']),
    venue('mealPlain', ['meal'], [], ['奶茶']),
  ];
  const ids = (f: Partial<VenueFilter>) => filterVenues(VENUES, { ...emptyVenueFilter(null), ...f }).map((v) => v.id);

  it('ANY by default, 未分类 for treat venues without types, never a meal-only venue', () => {
    expect(ids({ treatTypes: ['milk_tea'] })).toEqual(['tea', 'teaCake']);
    expect(ids({ treatTypes: ['milk_tea', 'coffee'] })).toEqual(['tea', 'teaCake', 'coffeeBoth']);
    expect(ids({ treatTypes: [UNCLASSIFIED_TREAT] })).toEqual(['untyped']);
    expect(ids({ treatTypes: [UNCLASSIFIED_TREAT, 'coffee'] })).toEqual(['coffeeBoth', 'untyped']);
    expect(ids({ treatTypes: [] })).toHaveLength(VENUES.length);
  });

  it('ALL needs every type; the type criterion ANDs with purpose, tags and search', () => {
    expect(ids({ treatTypes: ['milk_tea', 'cake'], treatTypeMode: 'all' })).toEqual(['teaCake']);
    expect(ids({ treatTypes: ['coffee'], purpose: 'meal' })).toEqual(['coffeeBoth']);
    expect(ids({ treatTypes: ['milk_tea'], q: 'cake' })).toEqual(['teaCake']);
    expect(ids({ treatTypes: ['milk_tea'], tags: ['奶茶'] })).toEqual([]);
    expect(matchesTreatTypes(VENUES[4]!, ['milk_tea'])).toBe(false);
  });

  it('choices and counts come from the whole supplied catalog (treat venues only)', () => {
    expect(treatTypeChoices(VENUES).map((c) => [c.value, c.count])).toEqual([
      ['milk_tea', 2],
      ['coffee', 1],
      ['cake', 1],
      [UNCLASSIFIED_TREAT, 1],
    ]);
    expect(treatTypeChoices([venue('m', ['meal'], ['coffee'])])).toEqual([]);
  });

  it('clearing criteria clears types too, and they count as active filters', () => {
    const f: VenueFilter = { ...emptyVenueFilter('treat'), q: 'x', tags: ['a'], treatTypes: ['cake', UNCLASSIFIED_TREAT] };
    expect(activeFilterCount(f)).toBe(3);
    expect(clearVenueCriteria(f)).toEqual({ ...emptyVenueFilter('treat'), q: 'x' });
  });

  it('remembers types per purpose; older entries without them and unknown values are safe', () => {
    const raw = JSON.stringify({
      version: 1,
      treat: { tags: [], tagMode: 'any', places: [], treatTypes: ['coffee', 'nope', UNCLASSIFIED_TREAT, 'coffee'] },
      meal: { tags: [], tagMode: 'any', places: [] },
    });
    expect(parseRemembered(raw, 'treat')?.treatTypes).toEqual(['coffee', UNCLASSIFIED_TREAT]);
    expect(parseRemembered(raw, 'meal')?.treatTypes).toEqual([]);
    const garbage = JSON.stringify({ version: 1, treat: { tags: [], tagMode: 'any', places: [], treatTypes: 'coffee' } });
    expect(parseRemembered(garbage, 'treat')?.treatTypes).toEqual([]);
  });
});

// ---------- Bulk importer ----------

const KATSU = 'https://www.google.com/maps/place/Katsu+San+Richmond/data=!4m2!3m1!1s0x54860baf877a0bfd:0xbbeb7dc28fc54b8a';
const DEER = 'https://www.google.com/maps/place/Deer+Garden/data=!4m2!3m1!1s0x5486753000a08ef7:0xd8c9468b997714a3';
const OTHER = 'https://www.google.com/maps/place/Cafe/data=!4m2!3m1!1s0x5486000000000002:0x00000000000000a1';

function resolvedRows(urls: string[]): QueueRow[] {
  let n = 0;
  const result = parsePaste(urls.join('\n'), [], () => `row-${(n += 1)}`);
  if (!result.ok) throw new Error(result.error);
  return result.rows.map((row) => {
    const preview: MapLinkPreview = {
      sourceUrl: row.sourceUrl,
      resolvedUrl: row.sourceUrl,
      mapUrl: row.sourceUrl,
      expanded: false,
      name: `店 ${row.id}`,
      nameSource: 'place',
      nameTruncated: false,
      place: null,
      camera: null,
      identifiers: { placeId: null, ftid: null, cid: null, cidDerived: false, kgId: null },
      duplicates: [],
      notes: [],
    };
    return setRowPurposes(applyPreview(markResolving(row), row.sourceUrl, preview), ['treat']);
  });
}

describe('bulk importer treat types', () => {
  it('reads older drafts as untyped and keeps an unanswered batch byte-for-byte', () => {
    const [row] = resolvedRows([KATSU]);
    const v2Row: Record<string, unknown> = { ...row };
    delete v2Row.treatTypes;
    // An older client's body: exact bytes, no treatTypes key.
    const oldBody = JSON.stringify({ rows: [{ clientId: row!.id, name: row!.name, mapUrl: KATSU, sourceUrl: KATSU, tags: ['奶茶'], purposes: ['treat'] }] });
    const raw = JSON.stringify({ version: 2, rows: [v2Row], pendingCommit: { key: 'idem-key-123', body: oldBody, rowIds: [row!.id] } });
    const state = parseBulkDraft(raw)!;
    expect(state.rows[0]!.treatTypes).toEqual([]);
    expect(state.pendingCommit!.body).toBe(oldBody);
    // Saved again as the current version, reads back identical (body included).
    expect(JSON.parse(serializeBulkDraft(state)).version).toBe(BULK_DRAFT_VERSION);
    expect(parseBulkDraft(serializeBulkDraft(state))).toEqual(state);
    // Unknown types make a current draft malformed.
    expect(parseBulkDraft(JSON.stringify({ version: 3, rows: [{ ...row, treatTypes: ['tea'] }], pendingCommit: null }))).toBeNull();
  });

  it('batch types touch only selected, unlocked, unimported treat rows; per-row edits respect imported rows', () => {
    const [a, b, c, d] = resolvedRows([KATSU, DEER, OTHER, 'https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x5486000000000003:0x00000000000000b2']);
    const rows = [
      setRowTreatTypes(a!, ['cake']),
      { ...b!, selected: false },
      setRowPurposes(c!, ['meal']),
      d!,
    ];
    // Row d belongs to a submitted, unanswered batch.
    const locked: QueueState = { rows, pendingCommit: { key: 'idem-key-456', body: '{"rows":[]}', rowIds: [d!.id] } };
    const info = analyzeQueue(locked, []);

    const added = setTreatTypesSelected(rows, info, ['coffee'], 'add');
    expect(added.ok && added.applied).toBe(1);
    expect(added.ok && added.unchanged).toBe(1); // the meal row
    if (!added.ok) throw new Error('expected ok');
    expect(added.rows.map((r) => r.treatTypes)).toEqual([['coffee', 'cake'], [], [], []]);

    const replaced = setTreatTypesSelected(added.rows, info, [], 'replace');
    expect(replaced.ok && replaced.rows[0]!.treatTypes).toEqual([]);
    expect(setTreatTypesSelected(rows, info, [], 'add').ok).toBe(false);

    const imported: QueueRow = { ...a!, status: 'imported', imported: { id: 'x', name: 'x' } };
    expect(setRowTreatTypes(imported, ['coffee'])).toBe(imported);
  });

  it('sends each row its types explicitly ([] = 未分类)', () => {
    const [a, b] = resolvedRows([KATSU, DEER]);
    const s: QueueState = { rows: [setRowTreatTypes(a!, ['other', 'milk_tea']), b!], pendingCommit: null };
    const sent = commitRows(s, analyzeQueue(s, []));
    expect(sent.map((r) => r.treatTypes)).toEqual([['milk_tea', 'other'], []]);
  });
});

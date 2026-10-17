import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoOutcome, LocationSuggestion, MapLinkPreview, Restaurant, VenueLocation } from '../shared/types.js';
import { countryNameZh, formatLocation, outingKind } from '../shared/venue.js';
import {
  emptyVenueFilter,
  filterVenues,
  placeKeyLabel,
  placeScopeKey,
  placeTree,
  UNKNOWN_PLACE,
  type VenueFilter,
} from '../shared/venueFilter.js';
import { parseLocation, parsePurposes } from '../server/lib/restaurantValidation.js';
import { BULK_DRAFT_VERSION, parseBulkDraft, serializeBulkDraft } from '../web/src/lib/bulkDraft.js';
import {
  analyzeQueue,
  applyGeo,
  applyPreview,
  buildPendingCommit,
  commitRows,
  editRow,
  editRowLocation,
  fillLocationSelected,
  markGeoPending,
  markResolving,
  parsePaste,
  queueGeo,
  type QueueRow,
} from '../web/src/lib/bulkQueue.js';
import { draftToInput, emptyDraft, loadDraft } from '../web/src/lib/drafts.js';
import { incompatibleCandidates, withOuting } from '../web/src/lib/outing.js';
import { parseRemembered } from '../web/src/lib/venueFilterStore.js';
import { applySuggestion, locationPayload, replaceWithSuggestion, toLocationForm, editLocation } from '../web/src/lib/venueForm.js';

afterEach(() => vi.unstubAllGlobals());

const loc = (country: string, region: string, city: string): VenueLocation => ({ country, countryCode: '', region, city, source: 'manual' });
const NOWHERE = loc('', '', '');

function venue(id: string, tags: string[], location: VenueLocation, purposes: Restaurant['purposes'] = ['meal']): Restaurant {
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
    location,
    purposes,
    treatTypes: [],
    active: true,
    createdAt: '',
    updatedAt: '',
  };
}

const VENUES = [
  venue('sushi', ['日料', '约会'], loc('加拿大', 'British Columbia', 'Burnaby')),
  venue('bbq', ['烧烤'], loc('加拿大', 'British Columbia', 'Vancouver')),
  venue('richmondVA', ['日料'], loc('美国', 'Virginia', 'Richmond')),
  venue('richmondBC', ['火锅', '约会'], loc('加拿大', 'British Columbia', 'Richmond')),
  venue('kopi', ['咖啡'], loc('新加坡', '', 'Singapore'), ['treat']),
  venue('tea', ['奶茶'], NOWHERE, ['meal', 'treat']),
];
const ids = (f: Partial<VenueFilter>) => filterVenues(VENUES, { ...emptyVenueFilter(), ...f }).map((v) => v.id);
const key = (country: string, region?: string, city?: string) =>
  placeScopeKey({ level: city !== undefined ? 'city' : region !== undefined ? 'region' : 'country', country, region: region ?? '', city: city ?? '' });

describe('shared venue filters', () => {
  it('tags match ANY by default and ALL when switched', () => {
    expect(ids({ tags: ['日料', '烧烤'] })).toEqual(['sushi', 'bbq', 'richmondVA']);
    expect(ids({ tags: ['日料', '约会'], tagMode: 'all' })).toEqual(['sushi']);
    expect(ids({ tags: ['日料', '约会'], tagMode: 'any' })).toEqual(['sushi', 'richmondVA', 'richmondBC']);
  });

  it('places combine with OR, a parent includes its descendants, and same-name cities stay apart', () => {
    expect(ids({ places: [key('加拿大')] })).toEqual(['sushi', 'bbq', 'richmondBC']);
    expect(ids({ places: [key('加拿大', 'British Columbia', 'Richmond')] })).toEqual(['richmondBC']);
    expect(ids({ places: [key('美国', 'Virginia', 'Richmond'), key('加拿大', 'British Columbia', 'Burnaby')] })).toEqual(['sushi', 'richmondVA']);
    expect(ids({ places: [key('新加坡', '', 'Singapore')] })).toEqual(['kopi']);
    expect(ids({ places: [UNKNOWN_PLACE] })).toEqual(['tea']);
    // Case / spacing variants of the same text are the same scope.
    expect(ids({ places: [key('加拿大', ' british  columbia ')] })).toEqual(['sushi', 'bbq', 'richmondBC']);
  });

  it('purpose, places, tags, query and only-selected all combine with AND; search covers the location', () => {
    expect(ids({ purpose: 'treat' })).toEqual(['kopi', 'tea']);
    expect(ids({ purpose: 'meal', tags: ['奶茶', '日料'] })).toEqual(['sushi', 'richmondVA', 'tea']);
    expect(ids({ q: 'burnaby' })).toEqual(['sushi']);
    expect(ids({ q: 'virginia', tags: ['日料'] })).toEqual(['richmondVA']);
    expect(filterVenues(VENUES, { ...emptyVenueFilter(), onlySelected: true, places: [key('加拿大')] }, new Set(['bbq', 'kopi'])).map((v) => v.id)).toEqual(['bbq']);
  });

  it('derives the place tree and readable labels only from stored venues', () => {
    const tree = placeTree(VENUES);
    expect(tree.unknown).toBe(1);
    expect(tree.nodes.map((n) => [n.label, n.count])).toEqual([
      ['加拿大', 3],
      ['美国', 1],
      ['新加坡', 1],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh')));
    const ca = tree.nodes.find((n) => n.label === '加拿大')!;
    expect(ca.children[0]!.children.map((c) => c.label)).toEqual(['Burnaby', 'Richmond', 'Vancouver']);
    expect(placeKeyLabel(key('新加坡', '', 'Singapore'), tree.nodes)).toBe('新加坡 · Singapore');
    expect(placeKeyLabel(UNKNOWN_PLACE, tree.nodes)).toBe('未填地区');
  });

  it('remembered filters are versioned and validated; anything odd is ignored', () => {
    const good = JSON.stringify({ version: 1, treat: { tags: ['奶茶'], tagMode: 'all', places: [UNKNOWN_PLACE, 'bogus'] } });
    // Saved before treat types existed: read as no type criterion.
    expect(parseRemembered(good, 'treat')).toEqual({ tags: ['奶茶'], tagMode: 'all', places: [UNKNOWN_PLACE], treatTypes: [] });
    expect(parseRemembered(good, 'meal')).toBeNull();
    expect(parseRemembered(JSON.stringify({ version: 2, treat: { tags: [], tagMode: 'any', places: [] } }), 'treat')).toBeNull();
    expect(parseRemembered('{oops', 'treat')).toBeNull();
    expect(parseRemembered(JSON.stringify({ version: 1, treat: { tags: [1], tagMode: 'any', places: [] } }), 'treat')).toBeNull();
  });
});

describe('location and purpose rules', () => {
  it('validates and merges location input like the API does', () => {
    const stored: VenueLocation = { country: '加拿大', countryCode: 'CA', region: 'British Columbia', city: 'Burnaby', source: 'osm' };
    expect(parseLocation(undefined, stored)).toEqual(stored);
    expect(parseLocation({ region: 'BC' }, stored)).toEqual({ ...stored, region: 'BC', source: 'manual' });
    expect(parseLocation({ countryCode: 'jp' }, null)).toMatchObject({ country: '日本', countryCode: 'JP' });
    expect(() => parseLocation({ city: 'a\u0007b' }, null)).toThrow();
    expect(parsePurposes(undefined, ['treat'])).toEqual(['treat']);
    expect(parsePurposes(['treat', 'meal'], null)).toEqual(['meal', 'treat']);
    expect(() => parsePurposes([], ['meal'])).toThrow();
    expect(countryNameZh('HK')).toContain('香港');
    expect(formatLocation(NOWHERE)).toBe('');
    expect(outingKind({ mode: 'home', purpose: 'treat' })).toBe('home');
  });
});

const SUGGEST: LocationSuggestion = {
  country: '加拿大',
  countryCode: 'CA',
  region: 'British Columbia',
  city: 'Burnaby',
  providerCountry: 'Canada',
  attribution: '© OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
};

describe('venue form location state', () => {
  it('fills only empty fields, keeps typing, and marks the source honestly', () => {
    let s = editLocation(toLocationForm(null), 'city', 'Vancouver');
    const merged = applySuggestion(s, SUGGEST);
    expect(merged.state.values).toEqual({ country: '加拿大', region: 'British Columbia', city: 'Vancouver' });
    expect(merged.conflicts).toEqual([{ field: 'city', current: 'Vancouver', incoming: 'Burnaby' }]);
    expect(locationPayload(merged.state)).toMatchObject({ countryCode: 'CA', source: 'manual' });
    s = replaceWithSuggestion(merged.state, SUGGEST, ['city']);
    expect(locationPayload(s)).toEqual({ country: '加拿大', countryCode: 'CA', region: 'British Columbia', city: 'Burnaby', source: 'osm' });
    // Typing another country drops the code that belonged to the suggested one.
    expect(locationPayload(editLocation(s, 'country', '美国'))).toMatchObject({ countryCode: '', source: 'manual' });
    expect(locationPayload(toLocationForm(null))).toEqual({ country: '', countryCode: '', region: '', city: '', source: '' });
  });
});

describe('drafts and outings', () => {
  it('a draft from before purposes resubmits the identical body (same idempotency fingerprint)', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) } });
    const old = { ...emptyDraft('new-legacy', '2099-01-01'), mode: 'restaurant', candidateIds: ['r'], selectedRestaurantId: 'r' } as Record<string, unknown>;
    delete old.purpose;
    values.set('bx:draft:new-legacy', JSON.stringify(old));
    const restored = loadDraft('new-legacy')!;
    expect(restored.purpose).toBe('meal');
    expect(draftToInput(restored)).not.toHaveProperty('purpose');
    expect(draftToInput({ ...restored, purpose: 'treat' })).toMatchObject({ purpose: 'treat' });
  });

  it('switching to a treat names it 下午茶 only when unnamed and drops just the confirmed venues', () => {
    const draft = { ...emptyDraft('new-x', '2099-01-01'), mode: 'restaurant' as const, candidateIds: ['tea', 'bbq'], selectedRestaurantId: 'bbq' };
    expect(incompatibleCandidates(draft.candidateIds, VENUES, 'treat')).toEqual(['bbq']);
    const treat = withOuting(draft, 'treat', ['bbq']);
    expect(treat).toMatchObject({ purpose: 'treat', mealLabel: '下午茶', candidateIds: ['tea'], selectedRestaurantId: null });
    expect(withOuting({ ...draft, mealLabel: '周末咖啡' }, 'treat').mealLabel).toBe('周末咖啡');
  });
});

const KATSU =
  'https://www.google.com/maps/place/Katsu+San+Richmond/@49.1953668,-123.1098036,13z/data=!4m6!3m5!1s0x54860baf877a0bfd:0xbbeb7dc28fc54b8a!8m2!3d49.1699676!4d-123.1818262!16s%2Fg%2F11jgc9682c';

function resolvedRow(geo?: GeoOutcome): QueueRow {
  const result = parsePaste(KATSU, [], () => 'row-1');
  if (!result.ok) throw new Error(result.error);
  const preview: MapLinkPreview = {
    sourceUrl: KATSU,
    resolvedUrl: KATSU,
    mapUrl: KATSU,
    expanded: false,
    name: 'Katsu San Richmond',
    nameSource: 'place',
    nameTruncated: false,
    place: { lat: 49.1699676, lng: -123.1818262 },
    camera: null,
    identifiers: { placeId: null, ftid: null, cid: null, cidDerived: false, kgId: null },
    duplicates: [],
    notes: [],
    ...(geo ? { geo } : {}),
  };
  return applyPreview(markResolving(result.rows[0]!), KATSU, preview);
}

describe('bulk rows: region, purposes and drafts', () => {
  it('keeps a manual city over the suggestion and ignores a late answer for a changed link', () => {
    const typed = editRowLocation(resolvedRow(), 'city', 'Richmond');
    const asked = markGeoPending(queueGeo(typed));
    expect(asked.geo).toMatchObject({ status: 'pending', url: KATSU });
    const answered = applyGeo(asked, KATSU, { status: 'suggested', cached: false, suggestion: { ...SUGGEST, city: 'Vancouver' } });
    expect(answered.location.values).toEqual({ country: '加拿大', region: 'British Columbia', city: 'Richmond' });
    expect(answered.geo.message).toContain('Vancouver');

    const changed = editRow(asked, { mapUrl: 'https://www.google.com/maps/place/Other/data=!3d1!4d2' });
    expect(changed.geo.status).toBe('idle');
    const late = applyGeo(changed, KATSU, { status: 'suggested', cached: false, suggestion: SUGGEST });
    expect(late).toBe(changed);
    // Geo unavailable never turns the link itself into a failure.
    const unavailable = resolvedRow({ status: 'unavailable', message: '暂时连不上地区服务' });
    expect(unavailable).toMatchObject({ status: 'resolved', geo: { status: 'unavailable' } });
  });

  it('batch fill writes empty fields by default and overwrites only on request', () => {
    const a = editRowLocation(resolvedRow(), 'city', 'Richmond');
    const rows = [a];
    const info = analyzeQueue({ rows, pendingCommit: null }, []);
    const filled = fillLocationSelected(rows, info, { country: '加拿大', city: 'Burnaby' }, 'empty');
    expect(filled.ok && filled.rows[0]!.location.values).toEqual({ country: '加拿大', region: '', city: 'Richmond' });
    const replaced = fillLocationSelected(rows, info, { city: 'Burnaby' }, 'replace');
    expect(replaced.ok && replaced.rows[0]!.location.values.city).toBe('Burnaby');
    expect(fillLocationSelected(rows, info, { city: '  ' }, 'empty').ok).toBe(false);
  });

  it('reads a version-1 draft (with its unanswered batch byte-for-byte) as version 2', () => {
    const row = resolvedRow();
    const v1Row: Record<string, unknown> = { ...row };
    delete v1Row.location;
    delete v1Row.purposes;
    delete v1Row.geo;
    const oldBody = JSON.stringify({ rows: [{ clientId: row.id, name: row.name, mapUrl: KATSU, sourceUrl: KATSU, tags: [] }] });
    const raw = JSON.stringify({ version: 1, rows: [v1Row], pendingCommit: { key: 'idem-key-123', body: oldBody, rowIds: [row.id] } });
    const state = parseBulkDraft(raw)!;
    expect(state.rows[0]).toMatchObject({ purposes: ['meal'], geo: { status: 'idle' }, location: { values: { country: '', region: '', city: '' } } });
    expect(state.pendingCommit).toEqual({ key: 'idem-key-123', body: oldBody, rowIds: [row.id] });
    // Saving writes version 2, which reads back the same.
    expect(JSON.parse(serializeBulkDraft(state)).version).toBe(BULK_DRAFT_VERSION);
    expect(parseBulkDraft(serializeBulkDraft(state))).toEqual(state);
    // New rows send their region and purposes.
    const sent = commitRows({ rows: [{ ...state.rows[0]!, purposes: ['treat'] }], pendingCommit: null }, analyzeQueue({ rows: state.rows, pendingCommit: null }, []));
    expect(JSON.parse(buildPendingCommit(sent, 'k').body).rows[0]).toMatchObject({ purposes: ['treat'], location: { source: '' } });
    // A malformed region in a v2 draft discards the draft.
    expect(parseBulkDraft(JSON.stringify({ version: 2, rows: [{ ...row, purposes: ['x'] }], pendingCommit: null }))).toBeNull();
  });
});

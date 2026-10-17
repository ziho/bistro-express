import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeScopeKey } from '../shared/venueFilter';
import { parseRemembered } from '../web/src/lib/venueFilterStore';
import type { Restaurant } from '../shared/types';
import { emptyDraft, saveDraft, loadDraft, draftToInput } from '../web/src/lib/drafts';
import { drawableCandidates, withOuting } from '../web/src/lib/outing';
afterEach(() => vi.unstubAllGlobals());
describe('outing drafts across switches and reloads', () => {
  it('remembers treat candidates while cooking at home, including a reload, without submitting a treat home plan', () => {
    const values = new Map<string,string>();
    vi.stubGlobal('window', {localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
    let draft = withOuting(emptyDraft('new-test-outing','2099-01-01'),'treat');
    draft = {...draft,candidateIds:['cafe'],selectedRestaurantId:'cafe'};
    const home = withOuting(draft,'home');
    saveDraft(home);
    const restored = loadDraft(home.key)!;
    expect(restored.purpose).toBe('treat');
    expect(draftToInput(restored)).toMatchObject({mode:'home',purpose:'meal',candidateIds:[]});
    expect(withOuting(restored,'treat')).toMatchObject({mode:'restaurant',purpose:'treat',candidateIds:['cafe'],selectedRestaurantId:'cafe'});
  });
  it('never draws an inactive venue even if a caller supplies a catalog containing it', () => {
    const venues = [
      {id:'meal',purposes:['meal'],active:true},
      {id:'treat',purposes:['treat'],active:true},
      {id:'inactive',purposes:['treat'],active:false},
    ] as Restaurant[];
    expect(drawableCandidates(['meal','treat','inactive','unknown'],venues,'treat')).toEqual(['treat']);
  });
});

describe('worldwide place filter persistence', () => {
  it('keeps a valid non-Latin city path after URI encoding expands it beyond 200 characters', () => {
    const key = placeScopeKey({level:'city',country:'加拿大',region:'British Columbia',city:'城市名称'.repeat(10)});
    expect(key.length).toBeGreaterThan(200);
    const raw = JSON.stringify({version:1,meal:{tags:[],tagMode:'any',places:[key]}});
    expect(parseRemembered(raw,'meal')?.places).toEqual([key]);
  });
});

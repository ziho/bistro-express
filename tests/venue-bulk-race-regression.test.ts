import { describe, expect, it } from 'vitest';
import type { GeoOutcome } from '../shared/types';
import { analyzeQueue, applyGeo, countQueue, newRow, type QueueRow } from '../web/src/lib/bulkQueue';

import { parseBulkDraft, serializeBulkDraft } from '../web/src/lib/bulkDraft';

const url = 'https://www.google.com/maps/place/Tea/data=!3d49.2!4d-123.1';
const suggested: GeoOutcome = {status:'suggested',suggestion:{country:'加拿大',countryCode:'CA',region:'British Columbia',city:'Burnaby',providerCountry:'Canada',attribution:'OpenStreetMap',attributionUrl:'https://www.openstreetmap.org/copyright'}};
const row = (): QueueRow => ({...newRow(url,'test-row'),status:'resolved',name:'Tea',mapUrl:url,geo:{status:'pending',message:null,url}});

describe('bulk import waits for the row region lookup to settle', () => {
  it('cannot freeze an import payload while its region is still queued or pending, but a failed optional lookup permits import', () => {
    const pending = row();
    const state = {rows:[pending],pendingCommit:null};
    expect(analyzeQueue(state,[]).get(pending.id)?.importable).toBe(false);
    expect(analyzeQueue({...state,rows:[{...pending,geo:{...pending.geo,status:'queued'}}]},[]).get(pending.id)?.importable).toBe(false);
    expect(analyzeQueue({...state,rows:[{...pending,geo:{...pending.geo,status:'unavailable'}}]},[]).get(pending.id)?.importable).toBe(true);
    const resolved = applyGeo(pending,url,suggested);
    expect(analyzeQueue({...state,rows:[resolved]},[]).get(pending.id)?.importable).toBe(true);
  });
  it('counts an interrupted region retry as waiting after reload so the Continue button is available', () => {
    const restored = parseBulkDraft(serializeBulkDraft({rows:[row()],pendingCommit:null}))!;
    expect(restored.rows[0]!.geo.status).toBe('queued');
    expect(countQueue(restored,analyzeQueue(restored,[]))).toMatchObject({waiting:1,importable:0});
  });
  it('ignores a delayed region suggestion after a row has already been imported', () => {
    const saved = {...row(),status:'imported' as const,imported:{id:'saved',name:'Tea'}};
    expect(applyGeo(saved,url,suggested)).toBe(saved);
  });
});

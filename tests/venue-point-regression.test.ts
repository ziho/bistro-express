import { describe, expect, it } from 'vitest';
import { parseMapsUrl } from '../shared/mapsUrl';
import { reliablePoint } from '../server/geo/point';
const point = (url: string) => reliablePoint(parseMapsUrl(new URL(url)));
describe('unambiguous place coordinates for region lookup', () => {
  it('accepts a bare coordinate link, but not a directions/search target with an unrelated fallback point', () => {
    expect(point('https://www.google.com/maps?q=49.17,-123.18')).toMatchObject({ok:true});
    expect(point('https://www.google.com/maps/dir/?q=49.17,-123.18')).toMatchObject({ok:false});
    expect(point('https://www.google.com/maps/place/A+Different+Shop?q=49.17,-123.18')).toMatchObject({ok:false});
  });
  it('does not treat query fallback coordinates as the point of a place ID that Google prioritizes', () => {
    expect(point('https://www.google.com/maps/search/?api=1&query=49.17,-123.18&query_place_id=ChIJabcdefghijk')).toMatchObject({ok:false});
    expect(point('https://www.google.com/maps?q=49.17,-123.18&cid=1234567890')).toMatchObject({ok:false});
  });
  it('still accepts the place own data coordinates when identifiers are present', () => {
    expect(point('https://www.google.com/maps/place/Example/data=!1s0x1:0x2!3d49.17!4d-123.18')).toMatchObject({ok:true,point:{lat:49.17,lng:-123.18}});
  });
});

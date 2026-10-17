import type { ParsedMapsLink } from '../../shared/mapsUrl.js';
import type { LatLng } from '../../shared/types.js';

export type PointChoice = { ok: true; point: LatLng } | { ok: false; message: string };

/**
 * The only coordinates trusted for a region lookup:
 * - the place's own !3d/!4d point of a /maps/place/… link (not a search result list), or
 * - a link that is itself just a coordinate pair (q=lat,lng or /maps/place/lat,lng).
 * Never the "@lat,lng" camera centre, never a search by shop name (several branches may match),
 * and never anything guessed from the name, an IP address or a place ID without coordinates.
 */
export function reliablePoint(parsed: ParsedMapsLink): PointChoice {
  if (parsed.place && parsed.placeSource === 'coords') {
    // Google prioritizes a place ID over query, so q=lat,lng may only be its unrelated fallback.
    // https://developers.google.com/maps/documentation/urls/get-started#search-action
    const bare = !parsed.placeId && !parsed.ftid && !parsed.cid && !parsed.kgId && !parsed.name;
    const coordinatePath = parsed.pathKind === null || parsed.pathKind === 'place' || parsed.pathKind === 'search';
    if (bare && coordinatePath) return { ok: true, point: parsed.place };
    return { ok: false, message: '链接同时含有其他地点或路线信息，无法确认备用坐标属于这家店，请手动填写地区。' };
  }
  if (parsed.place && parsed.placeSource === 'data' && parsed.pathKind === 'place' && parsed.nameSource !== 'query') {
    return { ok: true, point: parsed.place };
  }
  if (parsed.place) return { ok: false, message: '这是搜索结果链接，坐标不一定就是这家店，请手动填写地区。' };
  if (parsed.camera) return { ok: false, message: '链接只带有地图视角中心（@坐标），那不是店铺的位置，请手动填写地区。' };
  if (parsed.placeId || parsed.ftid || parsed.cid || parsed.kgId) {
    return { ok: false, message: '链接只有地点编号、没有坐标，无法识别地区，请手动填写。' };
  }
  return { ok: false, message: '链接里没有店铺坐标，请手动填写地区。' };
}

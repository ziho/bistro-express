import type { LatLng } from './types.js';

/**
 * Pure parsing of Google Maps *URLs* (https://developers.google.com/maps/documentation/urls).
 * This reads only what the link itself encodes; it is not Places data and makes no requests.
 */

export type MapsLinkKind = 'short' | 'maps';

export type Classified = { ok: true; url: URL; kind: MapsLinkKind } | { ok: false; reason: string };

/** Short-link hosts whose redirects we may follow (server-side, bounded, validated per hop). */
const SHORT_LINKS: Record<string, RegExp> = {
  'maps.app.goo.gl': /^\/[A-Za-z0-9_-]{4,64}\/?$/,
  'goo.gl': /^\/maps\/[A-Za-z0-9_-]{4,64}\/?$/,
};

/** google.com and Google's country domains, optionally with www. / maps. */
// Exact Google domain snapshot: https://www.google.com/supported_domains
const GOOGLE_DOMAINS = new Set(["google.ad", "google.ae", "google.al", "google.am", "google.as", "google.at", "google.az", "google.ba", "google.be", "google.bf", "google.bg", "google.bi", "google.bj", "google.bs", "google.bt", "google.by", "google.ca", "google.cat", "google.cd", "google.cf", "google.cg", "google.ch", "google.ci", "google.cl", "google.cm", "google.cn", "google.co.ao", "google.co.bw", "google.co.ck", "google.co.cr", "google.co.id", "google.co.il", "google.co.in", "google.co.jp", "google.co.ke", "google.co.kr", "google.co.ls", "google.co.ma", "google.co.mz", "google.co.nz", "google.co.th", "google.co.tz", "google.co.ug", "google.co.uk", "google.co.uz", "google.co.ve", "google.co.vi", "google.co.za", "google.co.zm", "google.co.zw", "google.com", "google.com.af", "google.com.ag", "google.com.ar", "google.com.au", "google.com.bd", "google.com.bh", "google.com.bn", "google.com.bo", "google.com.br", "google.com.bz", "google.com.co", "google.com.cu", "google.com.cy", "google.com.do", "google.com.ec", "google.com.eg", "google.com.et", "google.com.fj", "google.com.gh", "google.com.gi", "google.com.gt", "google.com.hk", "google.com.jm", "google.com.kh", "google.com.kw", "google.com.lb", "google.com.ly", "google.com.mm", "google.com.mt", "google.com.mx", "google.com.my", "google.com.na", "google.com.ng", "google.com.ni", "google.com.np", "google.com.om", "google.com.pa", "google.com.pe", "google.com.pg", "google.com.ph", "google.com.pk", "google.com.pr", "google.com.py", "google.com.qa", "google.com.sa", "google.com.sb", "google.com.sg", "google.com.sl", "google.com.sv", "google.com.tj", "google.com.tr", "google.com.tw", "google.com.ua", "google.com.uy", "google.com.vc", "google.com.vn", "google.cv", "google.cz", "google.de", "google.dj", "google.dk", "google.dm", "google.dz", "google.ee", "google.es", "google.fi", "google.fm", "google.fr", "google.ga", "google.ge", "google.gg", "google.gl", "google.gm", "google.gr", "google.gy", "google.hn", "google.hr", "google.ht", "google.hu", "google.ie", "google.im", "google.iq", "google.is", "google.it", "google.je", "google.jo", "google.kg", "google.ki", "google.kz", "google.la", "google.li", "google.lk", "google.lt", "google.lu", "google.lv", "google.md", "google.me", "google.mg", "google.mk", "google.ml", "google.mn", "google.mu", "google.mv", "google.mw", "google.ne", "google.nl", "google.no", "google.nr", "google.nu", "google.pl", "google.pn", "google.ps", "google.pt", "google.ro", "google.rs", "google.ru", "google.rw", "google.sc", "google.se", "google.sh", "google.si", "google.sk", "google.sm", "google.sn", "google.so", "google.sr", "google.st", "google.td", "google.tg", "google.tl", "google.tm", "google.tn", "google.to", "google.tt", "google.vu", "google.ws"]);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function isMapsGoogleHost(host: string): boolean {
  return host.startsWith('maps.google.');
}

/** Strict allowlist check for a link we are about to parse or fetch. */
export function classifyMapsUrl(raw: string): Classified {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: '这不是有效的链接' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: '只支持 https:// 开头的 Google 地图链接' };
  if (url.username || url.password) return { ok: false, reason: '链接里不能包含用户名或密码' };
  if (url.port) return { ok: false, reason: '不支持带端口号的链接' };
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || IPV4_RE.test(host) || host.includes(':') || host.startsWith('[')) {
    return { ok: false, reason: '不支持 IP 地址或本机地址' };
  }
  const shortPath = SHORT_LINKS[host];
  if (shortPath) {
    return shortPath.test(url.pathname) ? { ok: true, url, kind: 'short' } : { ok: false, reason: '无法识别这个短链接' };
  }
  if (GOOGLE_DOMAINS.has(host.replace(/^(?:www\.|maps\.)/, ''))) {
    const isMapsPath = url.pathname === '/maps' || url.pathname.startsWith('/maps/');
    const isMapsRoot = isMapsGoogleHost(host) && url.pathname === '/';
    if (isMapsPath || isMapsRoot) return { ok: true, url, kind: 'maps' };
    return { ok: false, reason: '这个 Google 链接不是地图地点链接' };
  }
  return { ok: false, reason: '目前只支持 Google 地图链接（maps.app.goo.gl 或 google.com/maps）' };
}

export interface ParsedMapsLink {
  name: string | null;
  nameSource: 'place' | 'query' | null;
  placeId: string | null;
  ftid: string | null;
  cid: string | null;
  cidDerived: boolean;
  kgId: string | null;
  place: LatLng | null;
  /** 'data' = the place's own !3d/!4d point; 'coords' = the link itself is a bare coordinate pair. */
  placeSource: 'data' | 'coords' | null;
  /** The segment after /maps/ ('place', 'search', 'dir'…), or null. */
  pathKind: string | null;
  camera: (LatLng & { zoom: number | null }) | null;
  /** origin + path (+ allowlisted query params); tracking parameters removed. */
  cleanUrl: string;
}

const FTID_RE = /^0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}$/i;
const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;
const CID_RE = /^\d{1,20}$/;
const KG_RE = /^\/[gm]\/[A-Za-z0-9_-]{2,40}$/;
const COORD_PAIR_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const CAMERA_RE = /^@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d{1,2}(?:\.\d+)?)z)?/;
const KEPT_QUERY_PARAMS = ['api', 'q', 'query', 'query_place_id', 'cid', 'ftid'];

function latLng(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Untrusted text from the URL: decode, drop control characters, collapse whitespace. */
export function cleanText(raw: string, decode = true): string {
  let decoded = decode ? raw.replace(/\+/g, ' ') : raw;
  try {
    if (decode) decoded = decodeURIComponent(decoded);
  } catch {
    // keep the raw text if it is not valid percent-encoding
  }
  return decoded
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The CID is the second half of the feature id, as an unsigned decimal. */
export function cidFromFtid(ftid: string): string | null {
  const second = ftid.split(':')[1];
  if (!second) return null;
  try {
    return BigInt(second).toString(10);
  } catch {
    return null;
  }
}

interface DataFields {
  ftid: string | null;
  placeId: string | null;
  kgId: string | null;
  place: LatLng | null;
}

/** Reads the `!1s…!3d…!4d…!16s…` protobuf-ish tokens of a `data=` path segment. */
function parseDataSegment(segment: string): DataFields {
  const out: DataFields = { ftid: null, placeId: null, kgId: null, place: null };
  const tokens = segment.replace(/^data=/, '').split('!').filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const m = /^(\d+)([a-z])(.*)$/.exec(tokens[i]!);
    if (!m) continue;
    const [, field, type, rawValue = ''] = m;
    const value = cleanText(rawValue);
    if (type === 's' && field === '1' && FTID_RE.test(value)) out.ftid ??= value.toLowerCase();
    else if (type === 's' && (field === '1' || field === '19') && value.startsWith('ChIJ') && PLACE_ID_RE.test(value)) {
      out.placeId ??= value;
    } else if (type === 's' && field === '16' && KG_RE.test(value)) out.kgId ??= value;
    else if (type === 'd' && field === '3' && !out.place) {
      // The place's own point is a "!3d<lat>!4d<lng>" pair; "@lat,lng" is only the camera.
      const next = /^4d(-?\d+(?:\.\d+)?)$/.exec(tokens[i + 1] ?? '');
      if (next) out.place = latLng(Number(value), Number(next[1]));
    }
  }
  return out;
}

function cleanUrlOf(url: URL): string {
  const kept = new URLSearchParams();
  for (const key of KEPT_QUERY_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value);
  }
  const qs = kept.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

/** Parses an already-classified ('maps' kind) Google Maps URL. */
export function parseMapsUrl(url: URL): ParsedMapsLink {
  const result: ParsedMapsLink = {
    name: null,
    nameSource: null,
    placeId: null,
    ftid: null,
    cid: null,
    cidDerived: false,
    kgId: null,
    place: null,
    placeSource: null,
    pathKind: null,
    camera: null,
    cleanUrl: cleanUrlOf(url),
  };
  const segments = url.pathname.split('/').filter(Boolean);
  const mapsAt = segments.indexOf('maps');
  const kindSegment = mapsAt >= 0 ? segments[mapsAt + 1] : undefined;
  const nameSegment = mapsAt >= 0 ? segments[mapsAt + 2] : undefined;
  if (kindSegment && /^[a-z]{1,20}$/.test(kindSegment)) result.pathKind = kindSegment;
  if (nameSegment && !nameSegment.startsWith('@') && !nameSegment.startsWith('data=')) {
    const text = cleanText(nameSegment);
    const coords = COORD_PAIR_RE.exec(text);
    if (coords) {
      result.place = latLng(Number(coords[1]), Number(coords[2]));
      if (result.place) result.placeSource = 'coords';
    } else if (text && kindSegment === 'place') [result.name, result.nameSource] = [text, 'place'];
    else if (text && kindSegment === 'search') [result.name, result.nameSource] = [text, 'query'];
  }
  for (const segment of segments) {
    const camera = CAMERA_RE.exec(segment);
    if (camera && !result.camera) {
      const point = latLng(Number(camera[1]), Number(camera[2]));
      if (point) result.camera = { ...point, zoom: camera[3] ? Number(camera[3]) : null };
    }
    if (segment.startsWith('data=')) {
      const data = parseDataSegment(segment);
      result.ftid ??= data.ftid;
      result.placeId ??= data.placeId;
      result.kgId ??= data.kgId;
      if (data.place) [result.place, result.placeSource] = [data.place, 'data'];
    }
  }

  const params = url.searchParams;
  const query = params.get('query') ?? params.get('q');
  if (query) {
    const text = cleanText(query, false);
    const coords = COORD_PAIR_RE.exec(text);
    if (coords) {
      if (!result.place) {
        result.place = latLng(Number(coords[1]), Number(coords[2]));
        if (result.place) result.placeSource = 'coords';
      }
    } else if (text && !result.name) [result.name, result.nameSource] = [text, 'query'];
  }
  const placeId = params.get('query_place_id');
  if (placeId && PLACE_ID_RE.test(placeId)) result.placeId ??= placeId;
  const ftid = params.get('ftid');
  if (ftid && FTID_RE.test(ftid)) result.ftid ??= ftid.toLowerCase();
  const cid = params.get('cid');
  if (cid && CID_RE.test(cid)) result.cid = cid;
  if (!result.cid && result.ftid) {
    result.cid = cidFromFtid(result.ftid);
    result.cidDerived = result.cid !== null;
  }
  return result;
}

export function hasPlaceData(p: ParsedMapsLink): boolean {
  return Boolean(p.name || p.placeId || p.ftid || p.cid || p.place);
}

/** Finds the first http(s) link in pasted share text such as "店名\nhttps://maps.app.goo.gl/…". */
export function extractLink(text: string): string | null {
  const match = /https?:\/\/[^\s<>"'，。、）\]]+/i.exec(text);
  if (!match) return null;
  let link = match[0];
  // Preserve restaurant-name parentheses; remove only unmatched Markdown wrappers.
  while (link.endsWith(')') && [...link].filter((c) => c === ')').length > [...link].filter((c) => c === '(').length) {
    link = link.slice(0, -1);
  }
  return link;
}

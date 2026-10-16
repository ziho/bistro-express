export type ImageKind = 'jpeg' | 'png' | 'webp' | 'heic';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** Identify an upload by magic bytes only — client file names and MIME types are ignored. */
export function detectImageKind(buf: Uint8Array): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  const ascii = (start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && HEIF_BRANDS.has(ascii(8, 12))) return 'heic';
  return null;
}

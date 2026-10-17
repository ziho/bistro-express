import { NOTIFICATION_HISTORY } from './constants.js';

/** Same rule as the server: digits only, no sign/fraction/exponent/leading zero, within the cap. */
const PAGE_RE = /^[1-9]\d{0,5}$/;

/** Page number from a URL `?page=` value; anything missing or invalid falls back to page 1. */
export function parsePageParam(raw: string | null | undefined): number {
  if (!raw || !PAGE_RE.test(raw)) return 1;
  const page = Number(raw);
  return page <= NOTIFICATION_HISTORY.maxPage ? page : 1;
}

export function historyQuery(page: number, pageSize: number = NOTIFICATION_HISTORY.defaultPageSize): string {
  return `page=${page}&pageSize=${pageSize}`;
}

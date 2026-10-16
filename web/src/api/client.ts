import { API_PATH } from '../../../shared/constants';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const UNAUTHORIZED_EVENT = 'bx:unauthorized';

interface RequestOptions {
  json?: unknown;
  form?: FormData;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_PATH}${path}`, {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: opts.signal,
    });
  } catch {
    throw new ApiError(0, 'network', '网络好像断开了，请稍后再试');
  }

  let payload: { ok?: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } = {};
  try {
    payload = await res.json();
  } catch {
    // fall through with empty payload
  }
  if (!res.ok || !payload.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { admin: path.startsWith('/admin') } }));
    }
    const err = payload.error;
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `请求失败（${res.status}）`, err?.details);
  }
  return payload.data as T;
}

export const mediaUrl = (id: string, variant: 'thumb' | 'full' = 'thumb') => `${API_PATH}/media/${id}/${variant}`;

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

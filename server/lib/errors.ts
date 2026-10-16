import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (message = '找不到这个内容') => new HttpError(404, 'not_found', message);
export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'invalid_request', message, details);
export const unauthorized = (message = '请先验证身份') => new HttpError(401, 'unauthorized', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new HttpError(422, code, message, details);

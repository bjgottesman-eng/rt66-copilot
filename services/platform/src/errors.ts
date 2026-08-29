/**
 * API error type mapped to the contract error shape
 * `{ error: { code, message } }` by the Fastify error handler.
 * Messages must never contain secrets, tokens, or health values.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (): ApiError =>
  new ApiError(401, 'UNAUTHORIZED', 'missing or invalid credentials');
export const forbidden = (code: string, message: string): ApiError =>
  new ApiError(403, code, message);
export const notFound = (code: string, message: string): ApiError =>
  new ApiError(404, code, message);
export const badRequest = (message: string): ApiError => new ApiError(400, 'VALIDATION', message);

import type { Key } from '../i18n/en';
import type { Translatable } from '../i18n/errors';
import type { Phrase } from '../i18n/translate';
import { API_ERROR_CODES, type ApiErrorBody, type ApiErrorCode } from './types';

/**
 * Every failure the API layer produces (HTTP, network or timeout) arrives as
 * one of these, so callers never have to guess whether they caught a Response,
 * a TypeError from fetch or an AbortError.
 */
export class ApiError extends Error implements Partial<Translatable> {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  /**
   * Set only where the message is one of ours.
   *
   * A server that sent its own sentence keeps it: it knows what went wrong in
   * more detail than a status code does, and replacing it with a translated
   * generic would be trading accuracy for language. See i18n-plan.md.
   */
  readonly phrase?: Phrase<Key>;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
    phrase?: Phrase<Key>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.phrase = phrase;
  }

  /** The session is gone or was never there. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** The request never got an answer, so retrying may well work. */
  get isTransient(): boolean {
    return (
      this.code === API_ERROR_CODES.network ||
      this.code === API_ERROR_CODES.timeout ||
      this.status === 429 ||
      this.status >= 500
    );
  }

  static network(message = 'Could not reach the server'): ApiError {
    return new ApiError(0, API_ERROR_CODES.network, message, undefined, {
      key: 'error.network',
    });
  }

  static timeout(message = 'The server took too long to respond'): ApiError {
    return new ApiError(0, API_ERROR_CODES.timeout, message, undefined, {
      key: 'error.timeout',
    });
  }

  /**
   * Builds an ApiError from a non-2xx response body. Handles both our
   * `{ error: { code, message } }` envelope and Fastify's default
   * `{ statusCode, error, message }`, so an unhandled route still produces
   * something the UI can render.
   */
  static fromBody(status: number, body: unknown): ApiError {
    const fallback = defaultCodeForStatus(status);

    if (typeof body === 'object' && body !== null) {
      const envelope = body as Partial<ApiErrorBody> & Record<string, unknown>;
      if (
        typeof envelope.error === 'object' &&
        envelope.error !== null &&
        typeof (envelope.error as { code?: unknown }).code === 'string'
      ) {
        const error = envelope.error as ApiErrorBody['error'];
        return new ApiError(status, error.code, error.message || fallback.message, error.details);
      }
      if (typeof envelope.message === 'string') {
        return new ApiError(status, fallback.code, envelope.message);
      }
    }

    return new ApiError(status, fallback.code, fallback.message, undefined, fallback.phrase);
  }
}

function defaultCodeForStatus(status: number): {
  code: ApiErrorCode;
  message: string;
  phrase: Phrase<Key>;
} {
  switch (status) {
    case 400:
      return {
        code: API_ERROR_CODES.validation,
        message: 'The server rejected that request',
        phrase: { key: 'error.rejected' },
      };
    case 401:
      return {
        code: API_ERROR_CODES.unauthorized,
        message: 'You are not signed in',
        phrase: { key: 'error.unauthorized' },
      };
    case 403:
      return {
        code: API_ERROR_CODES.forbidden,
        message: 'You do not have access to that',
        phrase: { key: 'error.forbidden' },
      };
    case 404:
      return {
        code: API_ERROR_CODES.notFound,
        message: 'Not found',
        phrase: { key: 'error.notFound' },
      };
    case 429:
      return {
        code: API_ERROR_CODES.rateLimited,
        message: 'Too many attempts. Try again later.',
        phrase: { key: 'error.rateLimited' },
      };
    default:
      return status >= 500
        ? {
            code: 'server_error',
            message: 'Something went wrong on the server',
            phrase: { key: 'error.server' },
          }
        : {
            code: 'request_failed',
            message: 'The request failed',
            phrase: { key: 'error.requestFailed' },
          };
  }
}

/**
 * Thrown when a request is about to carry something that must never leave the
 * device. This is a bug in the caller, not a runtime condition. It is not an
 * ApiError, and it should never be caught and shown to a user.
 */
export class SecretLeakError extends Error {
  constructor(path: string) {
    super(
      `Blocked an outgoing request to ${path}: the body contained a value that must never leave this device.`,
    );
    this.name = 'SecretLeakError';
  }
}

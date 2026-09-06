import type { ZodSchema } from 'zod';
import { ZodError } from 'zod';
import { badRequest } from './errors.js';

/// Validates a request body and turns a Zod failure into a 400 the client can
/// render field-by-field. Routes call this rather than using a Fastify schema
/// so the same Zod definitions can be shared with the client package later.
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      throw badRequest(
        'validation_failed',
        'Some of the values you entered are not valid.',
        error.issues.map((issue) => ({
          field: issue.path.join('.') || null,
          message: issue.message,
        })),
      );
    }
    throw error;
  }
}

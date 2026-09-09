import { z } from 'zod';
import { newUsernameSchema } from '../auth/schemas.js';
import { screenUsername, usernameRejectionMessage } from '../../lib/usernameFilter.js';

/// Same cap as the client's field. Screened by the word filter like a
/// username: it is shown in place of one, to the same people.
const displayNameSchema = z
  .string()
  .trim()
  .max(32, 'A display name can be at most 32 characters.')
  .superRefine((value, ctx) => {
    const rejection = screenUsername(value);
    if (value && rejection) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: usernameRejectionMessage(rejection) });
    }
  });

/// Line breaks are kept: the client promises "exactly as you type them".
/// Only the ends are trimmed, so a paragraph cannot be all whitespace.
const aboutSchema = z
  .string()
  .max(190, 'The about text can be at most 190 characters.')
  .transform((value) => value.replace(/^\s+|\s+$/g, ''));

const accentSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is six hex digits.');

/// Bounded by length here and by content in the service. A banner is at most
/// 160 KB of bytes, which is 220 KB of base64 plus the prefix; anything
/// larger is refused before it is decoded.
const pictureSchema = z.string().max(240 * 1024);

/// Every field optional: the client sends what changed and nothing else.
/// A null picture or accent means "remove it"; absent means "leave it".
export const updateProfileSchema = z
  .object({
    username: newUsernameSchema.optional(),
    displayName: displayNameSchema.optional(),
    about: aboutSchema.optional(),
    accent: accentSchema.nullable().optional(),
    avatar: pictureSchema.nullable().optional(),
    banner: pictureSchema.nullable().optional(),
    presence: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
    readReceipts: z.boolean().optional(),
    friendRequestsFrom: z.enum(['everyone', 'friends_of_friends', 'nobody']).optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

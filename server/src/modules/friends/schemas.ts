import { z } from 'zod';
import { usernameSchema } from '../auth/schemas.js';

/// Adding someone is by exact username and nothing else.
///
/// This is the one lookup in the codebase that answers honestly whether an
/// account exists - every other one returns a generic response so it cannot be
/// used to enumerate users. The exception is deliberate: a username is a handle
/// people hand out, an email address is not, and a friend request that cannot
/// say "no such user" is unusable. It is narrowed two ways instead: exact match
/// only (no prefix, no fuzzy, no listing), and a per-account hourly cap in
/// service.ts rather than a per-IP one, so renting addresses buys nothing.
export const sendFriendRequestSchema = z.object({
  username: usernameSchema,
});

export const userIdSchema = z.object({
  userId: z.string().uuid(),
});

export const friendshipIdSchema = z.object({
  id: z.string().uuid(),
});

export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

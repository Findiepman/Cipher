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

/// Your own private label for somebody. Not screened by the username filter:
/// nobody else ever reads it, so there is nobody to offend with it.
export const setNicknameSchema = z.object({
  nickname: z.string().trim().min(1, 'A nickname cannot be empty.').max(32),
});

export type SendFriendRequestInput = z.infer<typeof sendFriendRequestSchema>;

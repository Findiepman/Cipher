/**
 * Conversations and the messages in them.
 *
 * The server's whole job for a message body is: accept a sealed blob, store it,
 * hand it to the participant it is addressed to. It never reads one, never
 * indexes one, never logs one (server/AGENTS.md). Everything this module knows
 * about a message is its header - who, when, and in which conversation.
 *
 * That is also why "unread" and "what is new" are expressed as message ids: the
 * server can order messages but cannot look inside them, so a cursor is the
 * client's own last-seen id rather than anything derived from content.
 */
import { prisma } from '../../db.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { areFriends, requireFriendship } from '../friends/service.js';
import type { BacklogQuery, SendMessageInput } from './schemas.js';

export interface ConversationDto {
  id: string;
  kind: 'dm';
  /// Everyone in it, the caller included.
  participants: { id: string; username: string; publicKey: string | null }[];
  /// The id and time of the newest message, so a client can tell whether it is
  /// behind. Not a preview - the server has no readable text to preview.
  lastMessage: { id: string; authorId: string; sentAt: string } | null;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  authorId: string;
  clientId: string;
  sentAt: string;
  /// The single envelope addressed to whoever asked. A caller is never handed
  /// a copy sealed for somebody else - it would be unreadable to them anyway,
  /// and shipping it would only widen what an attacker gets from one response.
  ciphertext: string;
}

/// "<smaller uuid>:<larger uuid>". Behind a unique index, so opening a DM twice
/// - even concurrently from both sides - yields one conversation.
function dmKeyFor(x: string, y: string): string {
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

export async function openDm(
  userId: string,
  otherUserId: string,
): Promise<ConversationDto> {
  if (userId === otherUserId) {
    throw badRequest('cannot_dm_self', 'You cannot open a conversation with yourself.');
  }

  // Friendship is the gate. Without it, anyone who learned a user id could open
  // a channel to them, which is the messaging equivalent of an unlisted number
  // that anybody can dial.
  await requireFriendship(userId, otherUserId);

  const dmKey = dmKeyFor(userId, otherUserId);

  const existing = await prisma.conversation.findUnique({ where: { dmKey } });
  if (existing) return loadConversation(existing.id);

  try {
    const created = await prisma.conversation.create({
      data: {
        dmKey,
        participants: {
          create: [{ userId }, { userId: otherUserId }],
        },
      },
    });
    return loadConversation(created.id);
  } catch (error) {
    // Lost a race against the other party opening the same DM. The unique index
    // is the real guard; just read back whichever row won.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.conversation.findUniqueOrThrow({ where: { dmKey } });
    return loadConversation(winner.id);
  }
}

export async function listConversations(userId: string): Promise<ConversationDto[]> {
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId } } },
    include: conversationInclude,
  });

  return rows
    .map(toConversationDto)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationDto> {
  await requireParticipant(userId, conversationId);
  return loadConversation(conversationId);
}

export async function getBacklog(
  userId: string,
  conversationId: string,
  query: BacklogQuery,
): Promise<MessageDto[]> {
  await requireParticipant(userId, conversationId);

  // The cursor is a message id, so it has to be resolved to the row's position
  // before it can mean "everything after this". An id from another conversation
  // (or a deleted one) is treated as no cursor rather than as an error - the
  // worst case is re-sending history the client already merges by id.
  let afterSeq: bigint | null = null;
  if (query.after) {
    const cursor = await prisma.message.findFirst({
      where: { id: query.after, conversationId },
      select: { seq: true },
    });
    afterSeq = cursor?.seq ?? null;
  }

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      ...(afterSeq === null ? {} : { seq: { gt: afterSeq } }),
    },
    orderBy: { seq: 'asc' },
    take: query.limit,
    include: {
      // Only the caller's own copy leaves the database.
      envelopes: { where: { recipientUserId: userId }, select: { ciphertext: true } },
    },
  });

  return messages.flatMap((message) => {
    const envelope = message.envelopes[0];
    // A message with no copy for this caller cannot be rendered by them and is
    // not theirs to see. It should not happen; if it does, skipping is the
    // honest response, not inventing an empty body.
    if (!envelope) return [];
    return [
      {
        id: message.id,
        conversationId: message.conversationId,
        authorId: message.authorId,
        clientId: message.clientId,
        sentAt: message.sentAt.toISOString(),
        ciphertext: envelope.ciphertext,
      },
    ];
  });
}

export interface PostedMessage {
  id: string;
  clientId: string;
  sentAt: string;
  conversationId: string;
  authorId: string;
  /// Per participant, so the caller (HTTP route or socket handler) can deliver
  /// each recipient the one copy addressed to them.
  envelopes: { recipientUserId: string; ciphertext: string }[];
}

export async function postMessage(
  userId: string,
  conversationId: string,
  input: SendMessageInput,
): Promise<PostedMessage> {
  const participants = await requireParticipant(userId, conversationId);
  const others = participants.filter((id) => id !== userId);

  // Unfriending stops new messages without erasing what was already said. The
  // history stays readable to both sides; only the ability to add to it goes.
  for (const other of others) {
    if (!(await areFriends(userId, other))) {
      throw forbidden('not_friends', 'You are not friends with this user.');
    }
  }

  assertEnvelopesCoverParticipants(input.envelopes, participants);

  const existing = await prisma.message.findUnique({
    where: { conversationId_clientId: { conversationId, clientId: input.clientId } },
    include: { envelopes: { select: { recipientUserId: true, ciphertext: true } } },
  });
  if (existing) return toPostedMessage(existing);

  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        authorId: userId,
        clientId: input.clientId,
        envelopes: { create: input.envelopes },
      },
      include: { envelopes: { select: { recipientUserId: true, ciphertext: true } } },
    });
    return toPostedMessage(created);
  } catch (error) {
    // The same send arriving twice at once - a socket retry racing an HTTP
    // fallback, say. The unique index settles it; return whichever won.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.message.findUniqueOrThrow({
      where: { conversationId_clientId: { conversationId, clientId: input.clientId } },
      include: { envelopes: { select: { recipientUserId: true, ciphertext: true } } },
    });
    return toPostedMessage(winner);
  }
}

/// Exactly one sealed copy per participant. Too few and somebody in the
/// conversation is holding a message they cannot open; too many, or one
/// addressed outside the conversation, and the sender is using this server to
/// store a blob for a third party.
function assertEnvelopesCoverParticipants(
  envelopes: SendMessageInput['envelopes'],
  participants: string[],
): void {
  const addressed = new Set(envelopes.map((envelope) => envelope.recipientUserId));

  if (addressed.size !== envelopes.length) {
    throw badRequest('duplicate_envelope', 'Each participant takes exactly one envelope.');
  }

  const missing = participants.filter((id) => !addressed.has(id));
  const extra = [...addressed].filter((id) => !participants.includes(id));

  if (missing.length > 0 || extra.length > 0) {
    throw badRequest(
      'envelope_mismatch',
      'A message must be sealed for exactly the participants of its conversation.',
      { missing, extra },
    );
  }
}

/// Returns the participant ids, so callers get the membership check and the
/// list they were going to need anyway from one query.
export async function requireParticipant(
  userId: string,
  conversationId: string,
): Promise<string[]> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { participants: { select: { userId: true } } },
  });

  const ids = conversation?.participants.map((participant) => participant.userId) ?? [];

  // Not-a-participant and no-such-conversation are the same answer on purpose:
  // distinguishing them would confirm that a given conversation id exists.
  if (!conversation || !ids.includes(userId)) {
    throw notFound('conversation_not_found', 'No such conversation.');
  }

  return ids;
}

async function loadConversation(id: string): Promise<ConversationDto> {
  const row = await prisma.conversation.findUniqueOrThrow({
    where: { id },
    include: conversationInclude,
  });
  return toConversationDto(row);
}

const conversationInclude = {
  participants: {
    select: {
      user: {
        select: {
          id: true,
          username: true,
          devices: {
            where: { revokedAt: null },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { publicKey: true },
          },
        },
      },
    },
  },
  messages: {
    orderBy: { seq: 'desc' },
    take: 1,
    select: { id: true, authorId: true, sentAt: true },
  },
} as const;

type ConversationRow = {
  id: string;
  createdAt: Date;
  participants: {
    user: { id: string; username: string; devices: { publicKey: string }[] };
  }[];
  messages: { id: string; authorId: string; sentAt: Date }[];
};

function toConversationDto(row: ConversationRow): ConversationDto {
  const last = row.messages[0];
  return {
    id: row.id,
    kind: 'dm',
    participants: row.participants.map(({ user }) => ({
      id: user.id,
      username: user.username,
      publicKey: user.devices[0]?.publicKey ?? null,
    })),
    lastMessage: last
      ? { id: last.id, authorId: last.authorId, sentAt: last.sentAt.toISOString() }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/// Newest activity first, falling back to when the conversation was opened so
/// an empty one does not sink to the bottom of the list forever.
function sortKey(conversation: ConversationDto): string {
  return conversation.lastMessage?.sentAt ?? conversation.createdAt;
}

function toPostedMessage(message: {
  id: string;
  conversationId: string;
  authorId: string;
  clientId: string;
  sentAt: Date;
  envelopes: { recipientUserId: string; ciphertext: string }[];
}): PostedMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    authorId: message.authorId,
    clientId: message.clientId,
    sentAt: message.sentAt.toISOString(),
    envelopes: message.envelopes,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

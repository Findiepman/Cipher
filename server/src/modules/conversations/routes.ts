import type { FastifyPluginAsync } from 'fastify';
import { parseBody } from '../../lib/validate.js';
import {
  backlogQuerySchema,
  conversationIdSchema,
  openDmSchema,
  sendMessageSchema,
} from './schemas.js';
import {
  getBacklog,
  listConversations,
  openDm,
  postMessage,
  type MessageDto,
  type PostedMessage,
} from './service.js';

export interface ConversationRoutesOptions {
  /// Called after a message is stored, to push it to whoever is connected.
  /// Injected rather than imported so this module has no dependency on the
  /// socket layer - and so the HTTP API keeps working with no socket at all.
  deliver?: (message: PostedMessage) => void;
}

export const conversationRoutes: FastifyPluginAsync<ConversationRoutesOptions> = async (
  fastify,
  opts,
) => {
  fastify.addHook('preHandler', fastify.requireAuth);

  fastify.get('/', async (request) => {
    return { conversations: await listConversations(request.currentUser!.id) };
  });

  fastify.post('/dm', async (request, reply) => {
    const { userId } = parseBody(openDmSchema, request.body);

    return reply.send(await openDm(request.currentUser!.id, userId));
  });

  fastify.get('/:id/messages', async (request) => {
    const { id } = parseBody(conversationIdSchema, request.params);
    const query = parseBody(backlogQuerySchema, request.query);

    const messages = await getBacklog(request.currentUser!.id, id, query);

    return { messages, cursor: messages.at(-1)?.id ?? query.after ?? null };
  });

  /// The fallback path for sending. The socket is the normal one; this exists
  /// so a client with a dead websocket can still deliver, and both routes end
  /// up in the same postMessage() with the same idempotency on clientId.
  fastify.post('/:id/messages', async (request, reply) => {
    const { id } = parseBody(conversationIdSchema, request.params);
    const input = parseBody(sendMessageSchema, request.body);
    const userId = request.currentUser!.id;

    const posted = await postMessage(userId, id, input);
    opts.deliver?.(posted);

    // The sender gets back their own copy, in the same shape a recipient sees,
    // so one merge path in the client handles both.
    const own = posted.envelopes.find((envelope) => envelope.recipientUserId === userId);
    const dto: MessageDto = {
      id: posted.id,
      conversationId: posted.conversationId,
      authorId: posted.authorId,
      clientId: posted.clientId,
      sentAt: posted.sentAt,
      ciphertext: own?.ciphertext ?? '',
    };

    return reply.send(dto);
  });
};

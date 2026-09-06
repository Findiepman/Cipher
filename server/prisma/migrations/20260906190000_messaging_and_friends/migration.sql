-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- CreateTable
CREATE TABLE "Friendship" (
    "id" UUID NOT NULL,
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "blockedById" UUID,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "dmKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lastReadMessageId" UUID,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","userId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "clientId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEnvelope" (
    "messageId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "ciphertext" TEXT NOT NULL,

    CONSTRAINT "MessageEnvelope_pkey" PRIMARY KEY ("messageId","recipientUserId")
);

-- CreateIndex
CREATE INDEX "Friendship_userAId_status_idx" ON "Friendship"("userAId", "status");

-- CreateIndex
CREATE INDEX "Friendship_userBId_status_idx" ON "Friendship"("userBId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_dmKey_key" ON "Conversation"("dmKey");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_seq_idx" ON "Message"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_clientId_key" ON "Message"("conversationId", "clientId");

-- CreateIndex
CREATE INDEX "MessageEnvelope_recipientUserId_idx" ON "MessageEnvelope"("recipientUserId");

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

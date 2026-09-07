-- One person's private label for another. Directional: only the owner sees it.
CREATE TABLE "ContactNickname" (
    "ownerId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "nickname" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactNickname_pkey" PRIMARY KEY ("ownerId","subjectId")
);

CREATE INDEX "ContactNickname_subjectId_idx" ON "ContactNickname"("subjectId");

ALTER TABLE "ContactNickname" ADD CONSTRAINT "ContactNickname_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContactNickname" ADD CONSTRAINT "ContactNickname_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

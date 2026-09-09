-- Every preference that is not part of the friend-facing profile, kept as one
-- opaque JSON blob so it follows the account to every device. The server does
-- not read it; the friend-visible half lives in Profile.

CREATE TABLE "AccountSettings" (
    "userId" UUID NOT NULL,
    "blob" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSettings_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "AccountSettings" ADD CONSTRAINT "AccountSettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

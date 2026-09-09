-- What a person shows their friends, plus the two settings the server acts on
-- for them (presence and read receipts) and who may send them a friend
-- request. One optional row per account; no row means the defaults.

CREATE TYPE "ProfilePresence" AS ENUM ('ONLINE', 'IDLE', 'DND', 'INVISIBLE');

CREATE TYPE "FriendRequestPolicy" AS ENUM ('EVERYONE', 'FRIENDS_OF_FRIENDS', 'NOBODY');

CREATE TABLE "Profile" (
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "accent" TEXT,
    "avatar" TEXT,
    "banner" TEXT,
    "presence" "ProfilePresence" NOT NULL DEFAULT 'ONLINE',
    "readReceipts" BOOLEAN NOT NULL DEFAULT true,
    "friendRequestsFrom" "FriendRequestPolicy" NOT NULL DEFAULT 'EVERYONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

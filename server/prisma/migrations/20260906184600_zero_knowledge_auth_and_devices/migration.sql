-- The server stops seeing passwords.
--
-- `passwordHash` held argon2id(password). It now holds argon2id(authHash),
-- where authHash is itself derived from the password on the client and is the
-- only password-shaped value that ever reaches this process. Renamed rather
-- than dropped so no row is lost, but note that every pre-existing account is
-- effectively unauthenticatable: its stored value was derived from a different
-- input, and it has no Device row, which login now requires. Dev accounts from
-- before this migration need to register again.
ALTER TABLE "User" RENAME COLUMN "passwordHash" TO "authVerifier";

-- SHA-256 of the recovery code. Nullable: accounts created before the recovery
-- flow existed have none.
ALTER TABLE "User" ADD COLUMN "recoveryCodeHash" TEXT;

-- Device key material. The public key is the registry; the two wrapped blobs
-- are one private key sealed under the password and under the recovery code
-- respectively, and the server can open neither.
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "wrappedPrivateKey" TEXT NOT NULL,
    "wrappedPrivateKeyRecovery" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Device_userId_idx" ON "Device"("userId");
CREATE INDEX "Device_publicKey_idx" ON "Device"("publicKey");

ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

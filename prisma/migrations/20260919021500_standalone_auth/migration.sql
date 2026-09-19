-- Standalone (password) accounts for book.sothcare.com, independent of the
-- Sothcare SSO handoff. `passwordHash` is nullable: SSO-linked hosts never
-- get one, password hosts never get an `externalUserId`.
ALTER TABLE "Host" ADD COLUMN "passwordHash" TEXT;

-- Email is the login identifier for password accounts, so it has to be unique.
CREATE UNIQUE INDEX "Host_email_key" ON "Host"("email");

-- Server-side sessions so sign-out (and revoke-all-after-password-change)
-- take effect immediately rather than waiting for a token to expire.
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");
CREATE INDEX "Session_hostId_idx" ON "Session"("hostId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

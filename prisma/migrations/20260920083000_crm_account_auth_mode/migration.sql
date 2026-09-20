-- HubSpot can now be connected with a Private App access token (no developer
-- account / OAuth app needed). "oauth" keeps the existing refresh-token flow.
ALTER TABLE "CrmAccount" ADD COLUMN "authMode" TEXT NOT NULL DEFAULT 'oauth';

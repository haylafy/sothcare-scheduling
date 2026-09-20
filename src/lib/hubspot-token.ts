/**
 * Pure helpers for HubSpot Private App tokens -- kept free of Prisma imports
 * so they can be unit-tested without a database.
 */

/** The scopes the integration actually calls (contacts search/create, meetings, notes). */
export const HUBSPOT_REQUIRED_SCOPES = ["crm.objects.contacts.read", "crm.objects.contacts.write"] as const;

/** Trims whitespace and a pasted "Bearer " prefix; rejects anything that is clearly not a token. */
export function normalizePrivateAppToken(raw: string): string {
  const token = raw.trim().replace(/^bearer\s+/i, "").trim();
  if (!token) throw new Error("Paste the access token from your HubSpot private app.");
  if (/\s/.test(token)) throw new Error("That does not look like a single access token (it contains spaces).");
  if (token.length < 20) throw new Error("That token is too short to be a HubSpot access token.");
  return token;
}

/** Which required scopes are missing from what HubSpot reports for the token. */
export function missingHubSpotScopes(granted: readonly string[] | null | undefined): string[] {
  const have = new Set((granted ?? []).map((s) => s.trim()));
  return HUBSPOT_REQUIRED_SCOPES.filter((s) => !have.has(s));
}

/** Human label for the connection mode shown on the Integrations page. */
export function describeAuthMode(mode: string | null | undefined): string {
  return mode === "private_app" ? "Private App token" : "OAuth app";
}

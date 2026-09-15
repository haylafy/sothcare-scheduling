import type { CrmAccount } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { publicUrl } from "./env";

/**
 * HubSpot CRM integration.
 *
 * Mirrors src/lib/google.ts's shape deliberately: OAuth2 with a stored,
 * encrypted refresh token, a thin authenticated-fetch wrapper that refreshes
 * on 401 and persists the new access token, and small object-specific
 * helpers on top. HubSpot has no official Node SDK dependency added here --
 * the CRM v3/v4 REST API is a handful of endpoints and pulling in
 * @hubspot/api-client for this is more surface area than it's worth.
 *
 * Scope for this pass: Contacts (upsert by email) and logging a booking as
 * both a Meeting engagement and, for follow-up workflow steps, a plain
 * timeline Note. Deals are deliberately not here yet -- that needs the host
 * to have a real pipeline/stage set up on their end first, which is its own
 * piece of dashboard UI, not just an API call.
 */

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const HUBSPOT_API_BASE = "https://api.hubapi.com";

export const HUBSPOT_SCOPES = ["crm.objects.contacts.write", "crm.objects.contacts.read"];

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET are not configured");
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  return publicUrl("/api/crm/hubspot/callback");
}

export function hubspotConsentUrl(state: string): string {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    scope: HUBSPOT_SCOPES.join(" "),
    state,
  });
  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

async function exchangeCode(code: string): Promise<HubSpotTokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`HubSpot token exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<HubSpotTokenResponse> {
  const { clientId, clientSecret } = credentials();
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`HubSpot token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/** Exchange the OAuth code, look up the portal id, and store the account. */
export async function completeHubSpotConnection(code: string, hostId: string) {
  const tokens = await exchangeCode(code);

  const infoRes = await fetch(`${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${tokens.access_token}`);
  const info = infoRes.ok ? ((await infoRes.json()) as { hub_id?: number; scopes?: string[] }) : null;

  return prisma.crmAccount.upsert({
    where: { hostId_provider: { hostId, provider: "HUBSPOT" } },
    update: {
      refreshToken: encryptSecret(tokens.refresh_token),
      accessToken: encryptSecret(tokens.access_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: info?.scopes?.join(" ") ?? null,
      externalAccountId: info?.hub_id ? String(info.hub_id) : null,
      isActive: true,
      lastError: null,
    },
    create: {
      hostId,
      provider: "HUBSPOT",
      refreshToken: encryptSecret(tokens.refresh_token),
      accessToken: encryptSecret(tokens.access_token),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: info?.scopes?.join(" ") ?? null,
      externalAccountId: info?.hub_id ? String(info.hub_id) : null,
    },
  });
}

export async function getActiveHubSpotAccount(hostId: string): Promise<CrmAccount | null> {
  return prisma.crmAccount.findFirst({ where: { hostId, provider: "HUBSPOT", isActive: true } });
}

/** A live access token for this account, refreshing (and persisting) if expired. */
async function liveAccessToken(account: CrmAccount): Promise<string> {
  const stillValid = account.accessToken && account.expiresAt && account.expiresAt.getTime() - Date.now() > 60_000;
  if (stillValid) {
    try {
      return decryptSecret(account.accessToken!);
    } catch {
      // Encryption key rotated since this was stored -- fall through to a
      // real refresh below instead of using an undecryptable value.
    }
  }

  const refreshToken = decryptSecret(account.refreshToken);
  const tokens = await refreshAccessToken(refreshToken);
  await prisma.crmAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptSecret(tokens.access_token),
      // HubSpot may or may not rotate the refresh token on refresh; store it
      // again when it does, keep the existing one when it doesn't.
      refreshToken: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : account.refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      lastError: null,
    },
  });
  return tokens.access_token;
}

async function hubspotFetch(
  account: CrmAccount,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const token = await liveAccessToken(account);
  const res = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const message = `HubSpot ${path} failed: ${res.status} ${body}`;
    await prisma.crmAccount
      .update({ where: { id: account.id }, data: { lastError: message } })
      .catch(() => undefined);
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

interface HubSpotContactProperties {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
}

/** Find a contact by email; HubSpot has no upsert-by-email endpoint. */
async function findContactByEmail(account: CrmAccount, email: string): Promise<string | null> {
  const result = (await hubspotFetch(account, "/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      limit: 1,
    }),
  })) as { results?: Array<{ id: string }> };
  return result.results?.[0]?.id ?? null;
}

/** Create or update a contact by email, returning its HubSpot object id. */
export async function upsertContact(account: CrmAccount, properties: HubSpotContactProperties): Promise<string> {
  const existingId = await findContactByEmail(account, properties.email);
  if (existingId) {
    await hubspotFetch(account, `/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    return existingId;
  }
  const created = (await hubspotFetch(account, "/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  })) as { id: string };
  return created.id;
}

async function associateDefault(
  account: CrmAccount,
  objectType: "meetings" | "notes",
  objectId: string,
  contactId: string,
): Promise<void> {
  await hubspotFetch(account, `/crm/v4/objects/${objectType}/${objectId}/associations/default/contacts/${contactId}`, {
    method: "PUT",
  });
}

export interface MeetingEngagementInput {
  contactId: string;
  title: string;
  body?: string;
  start: Date;
  end: Date;
  outcome?: "SCHEDULED" | "COMPLETED" | "NO_SHOW" | "CANCELED";
}

/** Log the booking as a Meeting engagement on the contact's timeline. */
export async function logMeetingEngagement(account: CrmAccount, input: MeetingEngagementInput): Promise<string> {
  const created = (await hubspotFetch(account, "/crm/v3/objects/meetings", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_meeting_title: input.title,
        hs_meeting_body: input.body ?? "",
        hs_meeting_start_time: input.start.toISOString(),
        hs_meeting_end_time: input.end.toISOString(),
        hs_meeting_outcome: input.outcome ?? "SCHEDULED",
      },
    }),
  })) as { id: string };
  await associateDefault(account, "meetings", created.id, input.contactId);
  return created.id;
}

/** Update an existing meeting engagement's outcome (e.g. once marked no-show). */
export async function updateMeetingOutcome(
  account: CrmAccount,
  engagementId: string,
  outcome: MeetingEngagementInput["outcome"],
): Promise<void> {
  await hubspotFetch(account, `/crm/v3/objects/meetings/${engagementId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { hs_meeting_outcome: outcome } }),
  });
}

/** Log a plain timeline note -- used by the CRM_LOG_NOTE workflow action. */
export async function logTimelineNote(account: CrmAccount, contactId: string, body: string): Promise<string> {
  const created = (await hubspotFetch(account, "/crm/v3/objects/notes", {
    method: "POST",
    body: JSON.stringify({
      properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() },
    }),
  })) as { id: string };
  await associateDefault(account, "notes", created.id, contactId);
  return created.id;
}

import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type { CalendarAccount } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { publicUrl } from "./env";

/**
 * Google Calendar integration.
 *
 * A host can connect several Google accounts (personal, sothcare.com Workspace,
 * a shared demo calendar). Every calendar with `checkConflicts` blocks slots;
 * exactly one calendar per host is the `isWriteTarget` where new bookings land.
 */

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function oauthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured");
  }
  return new google.auth.OAuth2(clientId, clientSecret, publicUrl("/api/calendars/google/callback"));
}

export function googleConsentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always returns a refresh_token, even on reconnect
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

/** Exchange the OAuth code, store the account, and import its calendar list. */
export async function completeGoogleConnection(code: string, hostId: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token — revoke access and reconnect.");
  }
  client.setCredentials(tokens);

  const info = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = info.data.email;
  if (!email) throw new Error("Could not read the Google account email");

  const account = await prisma.calendarAccount.upsert({
    where: { hostId_provider_email: { hostId, provider: "GOOGLE", email } },
    update: {
      refreshToken: encryptSecret(tokens.refresh_token),
      accessToken: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
      isActive: true,
      lastError: null,
    },
    create: {
      hostId,
      provider: "GOOGLE",
      email,
      refreshToken: encryptSecret(tokens.refresh_token),
      accessToken: tokens.access_token ? encryptSecret(tokens.access_token) : null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope ?? null,
    },
  });

  await importCalendars(account.id);
  return account;
}

async function authFor(account: CalendarAccount): Promise<OAuth2Client> {
  const client = oauthClient();
  // Access tokens are live bearer credentials to the host's calendar, so they
  // are encrypted at rest alongside the refresh token.
  let accessToken: string | undefined;
  if (account.accessToken) {
    try {
      accessToken = decryptSecret(account.accessToken);
    } catch {
      accessToken = undefined; // rotated key: fall back to a refresh
    }
  }
  client.setCredentials({
    refresh_token: decryptSecret(account.refreshToken),
    access_token: accessToken,
    expiry_date: account.expiresAt?.getTime(),
  });
  // Persist silently refreshed access tokens so we are not re-refreshing on
  // every request.
  client.on("tokens", (tokens) => {
    if (!tokens.access_token) return;
    prisma.calendarAccount
      .update({
        where: { id: account.id },
        data: {
          accessToken: encryptSecret(tokens.access_token),
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      })
      .catch(() => undefined);
  });
  return client;
}

function calendarApi(auth: OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth });
}

/** Pull the account's calendar list into our `Calendar` table. */
export async function importCalendars(accountId: string) {
  const account = await prisma.calendarAccount.findUniqueOrThrow({ where: { id: accountId } });
  const api = calendarApi(await authFor(account));
  const { data } = await api.calendarList.list({ maxResults: 250, showHidden: false });

  const existingWriteTarget = await prisma.calendar.findFirst({
    where: { account: { hostId: account.hostId }, isWriteTarget: true },
  });

  for (const item of data.items ?? []) {
    if (!item.id) continue;
    const canWrite = item.accessRole === "owner" || item.accessRole === "writer";
    await prisma.calendar.upsert({
      where: { accountId_externalId: { accountId, externalId: item.id } },
      update: { name: item.summary ?? item.id, timezone: item.timeZone ?? null, isPrimary: !!item.primary },
      create: {
        accountId,
        externalId: item.id,
        name: item.summary ?? item.id,
        timezone: item.timeZone ?? null,
        isPrimary: !!item.primary,
        checkConflicts: true,
        // First writable primary calendar becomes the write target by default.
        isWriteTarget: !existingWriteTarget && !!item.primary && canWrite,
      },
    });
  }

  await prisma.calendarAccount.update({
    where: { id: accountId },
    data: { lastSyncedAt: new Date(), lastError: null },
  });
}

/**
 * Busy blocks across every conflict-checked calendar the host has connected.
 * Failures are swallowed per account: one expired token must not make the
 * booking page look wide open, so the account is flagged and its calendars are
 * treated as busy-unknown (we return what we could read and surface the error
 * in the dashboard).
 */
export async function getBusyTimes(
  hostId: string,
  from: Date,
  to: Date,
): Promise<Array<{ start: Date; end: Date }>> {
  const accounts = await prisma.calendarAccount.findMany({
    where: { hostId, isActive: true, provider: "GOOGLE" },
    include: { calendars: { where: { checkConflicts: true } } },
  });

  const busy: Array<{ start: Date; end: Date }> = [];

  await Promise.all(
    accounts.map(async (account) => {
      if (account.calendars.length === 0) return;
      try {
        const api = calendarApi(await authFor(account));
        const { data } = await api.freebusy.query({
          requestBody: {
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            items: account.calendars.map((c) => ({ id: c.externalId })),
          },
        });
        for (const cal of Object.values(data.calendars ?? {})) {
          for (const slot of cal.busy ?? []) {
            if (slot.start && slot.end) busy.push({ start: new Date(slot.start), end: new Date(slot.end) });
          }
        }
        if (account.lastError) {
          await prisma.calendarAccount.update({ where: { id: account.id }, data: { lastError: null } });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.calendarAccount
          .update({ where: { id: account.id }, data: { lastError: message } })
          .catch(() => undefined);
      }
    }),
  );

  return busy;
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timezone: string;
  attendees: string[];
  location?: string;
  addMeet: boolean;
}

export interface CalendarEventResult {
  calendarId: string;
  eventId: string;
  meetingUrl?: string;
  htmlLink?: string;
}

async function writeTargetFor(hostId: string) {
  return prisma.calendar.findFirst({
    where: { account: { hostId, isActive: true }, isWriteTarget: true },
    include: { account: true },
  });
}

export async function createCalendarEvent(
  hostId: string,
  input: CalendarEventInput,
): Promise<CalendarEventResult | null> {
  const target = await writeTargetFor(hostId);
  if (!target) return null;

  const api = calendarApi(await authFor(target.account));
  const { data } = await api.events.insert({
    calendarId: target.externalId,
    conferenceDataVersion: input.addMeet ? 1 : 0,
    sendUpdates: "none", // we send our own branded email from sothcare.com
    requestBody: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
      attendees: input.attendees.map((email) => ({ email })),
      ...(input.addMeet
        ? {
            conferenceData: {
              createRequest: {
                requestId: `sothcare-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
          }
        : {}),
    },
  });

  return {
    calendarId: target.externalId,
    eventId: data.id!,
    meetingUrl: data.hangoutLink ?? undefined,
    htmlLink: data.htmlLink ?? undefined,
  };
}

export async function updateCalendarEventTime(
  hostId: string,
  calendarId: string,
  eventId: string,
  start: Date,
  end: Date,
  timezone: string,
) {
  const account = await prisma.calendarAccount.findFirst({
    where: { hostId, isActive: true, calendars: { some: { externalId: calendarId } } },
  });
  if (!account) return;
  const api = calendarApi(await authFor(account));
  await api.events.patch({
    calendarId,
    eventId,
    sendUpdates: "none",
    requestBody: {
      start: { dateTime: start.toISOString(), timeZone: timezone },
      end: { dateTime: end.toISOString(), timeZone: timezone },
    },
  });
}

export async function deleteCalendarEvent(hostId: string, calendarId: string, eventId: string) {
  const account = await prisma.calendarAccount.findFirst({
    where: { hostId, isActive: true, calendars: { some: { externalId: calendarId } } },
  });
  if (!account) return;
  const api = calendarApi(await authFor(account));
  try {
    await api.events.delete({ calendarId, eventId, sendUpdates: "none" });
  } catch (error) {
    // Already gone is a success for our purposes.
    const status = (error as { code?: number }).code;
    if (status !== 404 && status !== 410) throw error;
  }
}

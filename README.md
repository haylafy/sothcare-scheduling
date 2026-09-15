# Sothcare Scheduling

A self-hosted Calendly, built to drop into the Sothcare app. Next.js 15 (App
Router) + Postgres + Prisma.

Four things it does:

| Feature | Where it lives |
|---|---|
| Unlimited event types | `EventType` model, `/dashboard/event-types`, public page at `/book/<host>/<event>` |
| Automated notifications & workflows | `src/lib/workflows.ts`, `/dashboard/workflows`, cron at `/api/cron/workflows` |
| Customisable booking page | Branding fields on `Host`, `/dashboard/branding`, `src/components/BrandShell.tsx` |
| Connect multiple calendars | `CalendarAccount` + `Calendar`, `src/lib/google.ts`, `/dashboard/calendars` |

---

## Run it locally

```bash
cp .env.example .env         # fill in DATABASE_URL at minimum
npm install
npx prisma migrate deploy    # or: npx prisma migrate dev
npm run db:seed              # creates a host, 3 event types, 4 workflows
npm run dev
```

Then open:

- `http://localhost:3000/book/salmaan` — the public booking page
- `http://localhost:3000/dashboard` — the admin side

With `MAIL_TRANSPORT=log` (the default) emails print to the console instead of
being sent, so you can click through the whole flow before touching SES.

Verify the parts that are easy to get subtly wrong:

```bash
npm test                     # 14 availability-engine tests: DST transition days, buffers, caps, seats
npx tsx scripts/smoke.mts    # book -> double-book refused -> reschedule -> cancel, against a real DB
```

---

## How availability is decided

`src/lib/availability.ts` is pure — no database, no network. It takes the
host's rules plus everything already busy and returns bookable slots, applying
in order:

1. **Weekly hours**, stored as minutes-from-midnight in the *schedule's*
   timezone. 9:00–17:00 stays 9:00–17:00 through daylight saving; there is a
   test that pins this.
2. **Date overrides** — a holiday or half day replaces that date's hours.
3. **The slot grid** — `slotIntervalMinutes` decides whether start times are
   :00/:15/:30/:45 or on the hour.
4. **Minimum notice** and the **rolling window** (how far ahead people can book).
5. **Buffers** — a booking blocks `[start − bufferBefore, end + bufferAfter]`
   for conflict purposes while the invitee still books a clean 20 minutes.
6. **Conflicts** — your own bookings plus busy time from every connected
   calendar marked *check for conflicts*.
7. **Daily caps** and **seats** (a `seatsPerSlot` above 1 makes it a group
   session, e.g. caregiver orientation).

Double booking is prevented in two stages. The full availability check (which
may call Google) runs first, outside any transaction. Then a short,
database-only transaction takes a Postgres advisory lock keyed on the host and
re-checks for an overlapping booking before inserting — so two people clicking
the same 10:00 at the same instant cannot both win, and no network call is ever
made with a lock held. The loser gets a 409 and a clear message, not a silent
overwrite.

---

## Connecting Google Calendar

1. Google Cloud console → new project → enable **Google Calendar API**.
2. OAuth consent screen: External, add scopes `calendar.events`,
   `calendar.readonly`, `userinfo.email`. While in testing mode add yourself as
   a test user; publish it before other staff connect.
3. Credentials → OAuth client ID → Web application → authorised redirect URI:
   `https://app.sothcare.com/api/calendars/google/callback` (and the localhost
   equivalent for dev).
4. Put the client id/secret in `.env`, then **Dashboard → Calendars → Connect a
   Google account**.

A host can connect several accounts. Every calendar you tick *check for
conflicts* hides slots; exactly one calendar is the *add bookings here* target.
Your sothcare.com Workspace accounts connect the same way as personal Gmail —
there is nothing special to do for a custom domain.

Refresh tokens are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
Rotating that key forces everyone to reconnect, which is the intended
behaviour.

---

## Email from your own domain

`MAIL_TRANSPORT=smtp` with the SES SMTP endpoint is the shortest path for
sothcare.com, since the domain is already verified in SES and `amazonses.com`
is already in the SPF record:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<SES SMTP username>
SMTP_PASS=<SES SMTP password>
MAIL_FROM="Sothcare <admin@sothcare.com>"
```

Set `MAIL_TRANSPORT=ses` instead to call the SES API directly
(`npm i @aws-sdk/client-sesv2` first).

One deliverability warning worth acting on: SPF alone is not enough. Publish
DKIM for whichever sender you use in the Route 53 hosted zone, or Gmail will
put booking confirmations in spam — which looks exactly like the product being
broken. Every send is recorded in `NotificationLog`, so "did the reminder go
out?" is answerable with one query.

---

## Workflows

Presets are one click in the dashboard: 24-hour reminder, 1-hour reminder,
15-minute heads-up to you, 1-hour follow-up, and a webhook on booking (point it
at HubSpot or Zapier to create the contact automatically).

- **Immediate triggers** (booked / cancelled / rescheduled) fire inline.
- **Time-based triggers** are written as `WorkflowRun` rows when the booking is
  made and picked up by the cron endpoint, so reminders survive deploys and
  restarts. The unique `(workflowId, bookingId)` index makes double-sending
  impossible; cancelling a booking cancels its pending runs.

Schedule the runner every five minutes:

```
EventBridge Scheduler / Vercel Cron  ->  POST /api/cron/workflows
Header: Authorization: Bearer $CRON_SECRET
```

Or run it as a scheduled container task: `npm run cron:run`.

Message bodies use `{{invitee_name}}`-style variables; the full list is shown
under each template in the dashboard.

---

## Security notes worth reading once

- **`x-sothcare-user-id` is trusted.** `src/lib/auth.ts` treats that header as
  proof of identity, so your edge (ALB, CloudFront, nginx) **must strip it from
  inbound requests** and set it itself. If a client can send it, a client can
  be any host. The cookie and "first host" fallbacks only work when
  `NODE_ENV !== "production"`. The real fix on integration is to delete that
  function and call Sothcare's session helper.
- **Refresh and access tokens** are encrypted at rest (AES-256-GCM,
  `TOKEN_ENCRYPTION_KEY`). Set that variable before connecting any calendar.
- **`CRON_SECRET` is required in production** — `/api/cron/workflows` returns
  503 without it rather than letting anyone fire every due workflow.
- **Webhook URLs** are checked to be public `https` and re-checked by DNS
  resolution immediately before the call, so a workflow cannot be pointed at
  `169.254.169.254` or a VPC host. Calls time out after 10 seconds.
- **Rate limits** on the public endpoints are in-process (10 bookings/min,
  120 slot queries/min per IP). With more than one instance each gets its own
  budget; swap the Map in `src/lib/rate-limit.ts` for Redis if you need exact
  limits across a fleet.
- **Custom CSS** on the booking page has angle brackets stripped on save and
  again on render, so it cannot close the `<style>` element.

## Dropping this into Sothcare

The module is deliberately self-contained. Three integration points:

1. **Auth** — `src/lib/auth.ts` is the only file that knows about sessions.
   Today it reads `x-sothcare-user-id` (header) or `sothcare_user_id` (cookie).
   Replace `currentExternalUserId()` with Sothcare's own session helper.
   Each Sothcare user maps to one `Host` row via `Host.externalUserId`.

2. **Mounting** — set `SCHEDULING_BASE_PATH=/scheduling` to serve everything
   under a sub-path, or copy `src/app/book`, `src/app/booking`,
   `src/app/dashboard` and `src/app/api` into the existing Next app and merge
   `prisma/schema.prisma`. Every internal link already goes through
   `BASE_PATH()`, so no hard-coded paths need editing.

3. **Database** — the schema is namespaced by model name and scoped to
   `Organization`, so it can live alongside the existing Sothcare tables in the
   same Postgres instance.

If your Sothcare front end is not Next.js, the public API is small enough to
call from anything: `GET /api/public/slots`, `POST /api/public/book`,
`POST /api/bookings/:uid/cancel`, `POST /api/bookings/:uid/reschedule`.

### Prisma engine note

The schema uses the `queryCompiler` preview feature with `@prisma/adapter-pg`,
so the client talks to Postgres through the driver adapter instead of the Rust
query engine — smaller Lambda/Fargate images and faster cold starts. To use the
classic engine instead, drop `previewFeatures` and `engineType` from
`prisma/schema.prisma` and replace the body of `src/lib/prisma.ts` with
`new PrismaClient()`.

---

## What is deliberately not here yet

Worth knowing before you promise any of it to a customer:

- **Microsoft 365 / Outlook and CalDAV.** The `CalendarProvider` enum and the
  account/calendar split already allow for them; `src/lib/google.ts` is the
  template to copy for Graph API.
- **SMS reminders.** `WorkflowAction` is where a `SMS_INVITEE` case goes —
  RingCentral is already in your stack and would be the natural sender.
- **Payments** (Stripe on booking).
- **Distributed rate limiting.** What is here is per-process (see above), which
  is an abuse brake rather than a guarantee.
- **Round-robin routing** across several hosts, and pooled team availability.
- **HIPAA posture.** Bookings hold names, emails and free-text notes an invitee
  might fill with clinical detail. If this ever books patients rather than
  prospects, that data is PHI: it belongs behind the same BAA, encryption and
  retention rules as the rest of Sothcare, and the Google Calendar event
  summary should stop including the invitee's name.

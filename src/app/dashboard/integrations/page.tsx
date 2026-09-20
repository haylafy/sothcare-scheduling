import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { connectHubSpotToken, disconnectCrmAccount } from "../actions";
import { Card, Button, TextInput } from "@/components/form";
import { BASE_PATH } from "@/lib/env";
import { describeAuthMode, HUBSPOT_REQUIRED_SCOPES } from "@/lib/hubspot-token";

export const dynamic = "force-dynamic";

function TokenForm({ replacing }: { replacing: boolean }) {
  return (
    <form action={connectHubSpotToken} className="space-y-3">
      <TextInput
        name="token"
        label={replacing ? "Paste a new Private App access token" : "Private App access token"}
        type="password"
        placeholder="pat-na1-…"
        required
        hint="The token is checked with HubSpot before it is saved, then stored encrypted. It is never shown again here."
      />
      <Button>{replacing ? "Replace token" : "Connect HubSpot"}</Button>
    </form>
  );
}

function HowToGetAToken() {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      <summary className="cursor-pointer font-semibold text-slate-800">How to get a Private App token (2 minutes)</summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">
        <li>In HubSpot, open <strong>Settings</strong> (gear icon) → <strong>Integrations</strong> → <strong>Private Apps</strong> (also listed under Development → Legacy apps). You need to be a super admin.</li>
        <li>Click <strong>Create a private app</strong>, name it “Sothcare Scheduling”.</li>
        <li>
          On the <strong>Scopes</strong> tab add exactly:{" "}
          {HUBSPOT_REQUIRED_SCOPES.map((s) => (
            <code key={s} className="mr-1 rounded bg-white px-1">
              {s}
            </code>
          ))}
        </li>
        <li>Click <strong>Create app</strong> → <strong>Continue creating</strong>, then on the Auth tab <strong>Show token</strong> → <strong>Copy</strong>.</li>
        <li>Paste it above. Rotating the token in HubSpot later? Paste the new one here the same way.</li>
      </ol>
    </details>
  );
}

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;
  const { connected, error } = await searchParams;

  const account = await prisma.crmAccount.findFirst({ where: { hostId: host.id, provider: "HUBSPOT" } });
  const oauthConfigured = Boolean(process.env.HUBSPOT_CLIENT_ID);
  const bookingCount = account
    ? await prisma.crmSyncRecord.count({ where: { hostId: host.id, provider: "HUBSPOT" } })
    : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500">
          Connect HubSpot to automatically create/update a contact and log a meeting on their timeline
          for every confirmed booking. Cancellations update the meeting outcome, and follow-up workflow
          steps can drop a note there.
        </p>
      </header>

      {connected && (
        <p className="rounded-lg bg-teal-50 px-4 py-2 text-sm text-teal-800">HubSpot connected.</p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">Could not connect: {error}</p>
      )}

      <Card title="HubSpot">
        {account ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Connected{account.externalAccountId ? ` to Hub ${account.externalAccountId}` : ""} via{" "}
              {describeAuthMode(account.authMode)}. {bookingCount} booking{bookingCount === 1 ? "" : "s"} synced.
            </p>
            {account.lastError && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Last sync failed: {account.lastError}
              </p>
            )}
            <TokenForm replacing />
            <div className="flex gap-3">
              {oauthConfigured && (
                <a
                  href={`${BASE_PATH()}/api/crm/hubspot/connect`}
                  className="inline-block rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Reconnect with OAuth instead
                </a>
              )}
              <form action={disconnectCrmAccount}>
                <input type="hidden" name="id" value={account.id} />
                <Button variant="danger">Disconnect</Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <TokenForm replacing={false} />
            <HowToGetAToken />
            {oauthConfigured && (
              <p className="text-sm text-slate-600">
                Prefer the OAuth flow?{" "}
                <a href={`${BASE_PATH()}/api/crm/hubspot/connect`} className="font-semibold text-teal-700 hover:underline">
                  Connect with a HubSpot developer app
                </a>
                .
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

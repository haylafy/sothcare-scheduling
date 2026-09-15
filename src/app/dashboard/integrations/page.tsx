import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { disconnectCrmAccount } from "../actions";
import { Card, Button } from "@/components/form";
import { BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;
  const { connected, error } = await searchParams;

  const account = await prisma.crmAccount.findFirst({ where: { hostId: host.id, provider: "HUBSPOT" } });
  const configured = Boolean(process.env.HUBSPOT_CLIENT_ID);
  const bookingCount = account
    ? await prisma.crmSyncRecord.count({ where: { hostId: host.id, provider: "HUBSPOT" } })
    : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Integrations</h1>
        <p className="text-sm text-slate-500">
          Connect HubSpot to automatically create/update a contact and log a meeting on their timeline
          for every confirmed booking. Follow-up workflow steps can also drop a note there.
        </p>
      </header>

      {connected && (
        <p className="rounded-lg bg-teal-50 px-4 py-2 text-sm text-teal-800">HubSpot connected.</p>
      )}
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">Could not connect: {error}</p>
      )}

      <Card title="HubSpot">
        {!configured ? (
          <p className="text-sm text-slate-600">
            Set <code className="rounded bg-slate-100 px-1">HUBSPOT_CLIENT_ID</code> and{" "}
            <code className="rounded bg-slate-100 px-1">HUBSPOT_CLIENT_SECRET</code> (from a HubSpot
            developer app) to enable this.
          </p>
        ) : account ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Connected{account.externalAccountId ? ` to Hub ${account.externalAccountId}` : ""}.{" "}
              {bookingCount} booking{bookingCount === 1 ? "" : "s"} synced.
            </p>
            {account.lastError && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Last sync failed: {account.lastError}. Reconnect below.
              </p>
            )}
            <div className="flex gap-3">
              <a
                href={`${BASE_PATH()}/api/crm/hubspot/connect`}
                className="inline-block rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reconnect
              </a>
              <form action={disconnectCrmAccount}>
                <input type="hidden" name="id" value={account.id} />
                <Button variant="danger">Disconnect</Button>
              </form>
            </div>
          </div>
        ) : (
          <a
            href={`${BASE_PATH()}/api/crm/hubspot/connect`}
            className="inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            + Connect HubSpot
          </a>
        )}
      </Card>
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { getCurrentHost } from "@/lib/auth";
import { createWorkflow, updateWorkflow, deleteWorkflow, createFollowUpSequence } from "../actions";
import { Card, TextInput, TextArea, Select, Toggle, Button } from "@/components/form";
import { describeTiming } from "@/lib/workflows";
import { TEMPLATE_VARIABLES } from "@/lib/templates";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;

  const workflows = await prisma.workflow.findMany({
    where: { hostId: host.id },
    include: { steps: { orderBy: { position: "asc" } }, _count: { select: { runs: true } } },
    orderBy: { createdAt: "asc" },
  });

  const pending = await prisma.workflowRun.count({ where: { status: "PENDING" } });
  const hubspotConnected = Boolean(
    await prisma.crmAccount.findFirst({ where: { hostId: host.id, provider: "HUBSPOT", isActive: true } }),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Workflows</h1>
        <p className="text-sm text-slate-500">
          Automated emails and webhooks around each booking. {pending} reminder
          {pending === 1 ? "" : "s"} queued.
        </p>
      </header>

      <Card
        title="Follow-up sequence"
        description="One click creates three staged follow-ups — 1 hour, 1 day, and 3 days after the meeting."
      >
        <form action={createFollowUpSequence} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[18rem] flex-1">
            <Select
              name="condition"
              label="Only send when"
              defaultValue="ANY"
              options={[
                { value: "ANY", label: "Every booking" },
                { value: "NO_SHOW_ONLY", label: "Marked as no-show" },
                { value: "ATTENDED_ONLY", label: "Marked as attended" },
              ]}
            />
          </div>
          <Button>Create sequence</Button>
        </form>
        {!hubspotConnected && (
          <p className="mt-3 text-xs text-slate-400">
            Connect HubSpot under Integrations to also log these as timeline notes on the contact.
          </p>
        )}
      </Card>

      <Card title="Add a single workflow">
        <form action={createWorkflow} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[18rem] flex-1">
            <Select
              name="preset"
              label="Start from"
              options={[
                { value: "reminder24h", label: "Reminder to invitee — 24 hours before" },
                { value: "reminder1h", label: "Reminder to invitee — 1 hour before" },
                { value: "hostHeadsUp", label: "Heads-up to me — 15 minutes before" },
                { value: "followUp", label: "Follow-up — 1 hour after" },
                { value: "crmWebhook", label: "Webhook on booking (HubSpot, Zapier, your API)" },
                ...(hubspotConnected
                  ? [{ value: "crmNote", label: "Log a HubSpot note — 1 hour after the meeting" }]
                  : []),
              ]}
            />
          </div>
          <Button>Add workflow</Button>
        </form>
      </Card>

      {workflows.map((workflow) => {
        const step = workflow.steps[0];
        const isWebhook = step?.action === "WEBHOOK";
        const isCrmNote = step?.action === "CRM_LOG_NOTE";
        const timed = workflow.trigger === "BEFORE_EVENT" || workflow.trigger === "AFTER_EVENT";

        return (
          <Card
            key={workflow.id}
            title={workflow.name}
            description={`${describeTiming(workflow.trigger, workflow.offsetMinutes)} · ${step?.action
              .toLowerCase()
              .replace("_", " ")} · ${workflow._count.runs} runs`}
          >
            <form action={updateWorkflow} className="space-y-4">
              <input type="hidden" name="id" value={workflow.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <TextInput name="name" label="Name" defaultValue={workflow.name} />
                {timed && (
                  <TextInput
                    name="offsetMinutes"
                    label="Minutes from the meeting"
                    type="number"
                    defaultValue={workflow.offsetMinutes}
                    min={0}
                  />
                )}
              </div>

              {workflow.trigger === "AFTER_EVENT" && (
                <Select
                  name="condition"
                  label="Only send when"
                  defaultValue={workflow.condition}
                  options={[
                    { value: "ANY", label: "Every booking" },
                    { value: "NO_SHOW_ONLY", label: "Marked as no-show" },
                    { value: "ATTENDED_ONLY", label: "Marked as attended" },
                  ]}
                />
              )}

              {isWebhook ? (
                <TextInput
                  name="webhookUrl"
                  label="Webhook URL"
                  defaultValue={step?.webhookUrl}
                  hint="Receives a JSON POST with the booking, invitee and answers."
                />
              ) : isCrmNote ? (
                <TextArea
                  name="body"
                  label="Note text (logged on the HubSpot contact's timeline)"
                  defaultValue={step?.body}
                  rows={4}
                  hint={`Variables: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`}
                />
              ) : (
                <>
                  <TextInput name="subject" label="Subject" defaultValue={step?.subject} />
                  <TextArea
                    name="body"
                    label="Message"
                    defaultValue={step?.body}
                    rows={8}
                    hint={`Variables: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}`}
                  />
                  <Toggle name="includeIcs" label="Attach a calendar invite (.ics)" defaultChecked={step?.includeIcs} />
                </>
              )}

              <Toggle name="isActive" label="Active" defaultChecked={workflow.isActive} />

              <div className="flex gap-3">
                <Button>Save</Button>
              </div>
            </form>

            <form action={deleteWorkflow} className="mt-2">
              <input type="hidden" name="id" value={workflow.id} />
              <Button variant="danger">Delete workflow</Button>
            </form>
          </Card>
        );
      })}
    </div>
  );
}

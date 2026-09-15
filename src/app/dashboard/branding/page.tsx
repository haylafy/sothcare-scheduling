import { getCurrentHost } from "@/lib/auth";
import { saveBranding } from "../actions";
import { Card, TextInput, TextArea, Select, Toggle, Button, TIMEZONES } from "@/components/form";
import { APP_URL, BASE_PATH } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const host = await getCurrentHost();
  if (!host) return <p className="text-sm text-slate-500">No scheduling profile yet.</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Booking page</h1>
        <p className="text-sm text-slate-500">
          Live at{" "}
          <a
            href={`${BASE_PATH()}/book/${host.slug}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-teal-700 hover:underline"
          >
            {APP_URL()}
            {BASE_PATH()}/book/{host.slug}
          </a>
        </p>
      </header>

      <form action={saveBranding} className="space-y-6">
        <Card title="Identity">
          <div className="grid gap-4 md:grid-cols-2">
            <TextInput name="name" label="Display name" defaultValue={host.name} required />
            <TextInput name="slug" label="URL slug" defaultValue={host.slug} hint="/book/<slug>" />
            <Select name="timezone" label="My timezone" defaultValue={host.timezone} options={TIMEZONES} />
            <TextInput name="avatarUrl" label="Avatar image URL" defaultValue={host.avatarUrl} />
            <TextInput name="logoUrl" label="Logo image URL" defaultValue={host.logoUrl} />
            <TextInput
              name="headline"
              label="Headline"
              defaultValue={host.headline}
              hint="Shown above your event types."
            />
          </div>
          <div className="mt-4">
            <TextArea name="welcomeText" label="Welcome text" defaultValue={host.welcomeText} rows={3} />
          </div>
        </Card>

        <Card title="Colours">
          <div className="grid gap-4 md:grid-cols-3">
            <TextInput name="brandColor" label="Brand colour" type="color" defaultValue={host.brandColor} />
            <TextInput
              name="accentTextOn"
              label="Text on brand colour"
              type="color"
              defaultValue={host.accentTextOn}
            />
            <TextInput
              name="pageBackground"
              label="Page background"
              type="color"
              defaultValue={host.pageBackground}
            />
          </div>
          <div className="mt-4">
            <TextArea
              name="customCss"
              label="Custom CSS"
              defaultValue={host.customCss}
              rows={6}
              mono
              hint="Injected into the booking page. Use for fonts or fine-tuning."
            />
          </div>
          <div className="mt-2">
            <Toggle
              name="showPoweredBy"
              label="Show “Scheduling by Sothcare” in the footer"
              defaultChecked={host.showPoweredBy}
            />
          </div>
        </Card>

        <Button>Save booking page</Button>
      </form>
    </div>
  );
}

import type { Host } from "@prisma/client";
import type { CSSProperties, ReactNode } from "react";

/**
 * Wraps every public page in the host's branding. Colours are applied as CSS
 * custom properties on a wrapper element, so one stylesheet serves every
 * tenant and a branding change is instant — no rebuild, no per-tenant CSS.
 */
export default function BrandShell({ host, children }: { host: Host; children: ReactNode }) {
  const style = {
    "--brand": host.brandColor,
    "--brand-text": host.accentTextOn,
    "--page-bg": host.pageBackground,
    background: host.pageBackground,
  } as CSSProperties;

  return (
    <div style={style} className="min-h-screen px-4 py-8 sm:py-12">
      {host.customCss && (
        /* Angle brackets are stripped on save and again here, so custom CSS
           cannot close the <style> element and become script. */
        <style dangerouslySetInnerHTML={{ __html: host.customCss.replace(/[<>]/g, "") }} />
      )}
      <div className="mx-auto w-full max-w-3xl">
        {host.logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={host.logoUrl} alt={host.name} className="mx-auto mb-6 h-9 object-contain" />
        )}
        {children}
        {host.showPoweredBy && (
          <p className="mt-8 text-center text-xs text-slate-400">Scheduling by Sothcare</p>
        )}
      </div>
    </div>
  );
}

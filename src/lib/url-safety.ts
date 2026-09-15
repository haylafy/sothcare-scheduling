import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

/**
 * Guards for the two places a URL supplied in the dashboard is later acted on:
 * a post-booking redirect (runs in the invitee's browser) and a workflow
 * webhook (fetched by our own server, which is an SSRF surface).
 */

/** `javascript:` and friends execute; only allow real navigations. */
export function isSafeRedirectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function sanitizeRedirectUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isSafeRedirectUrl(trimmed) ? trimmed : null;
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) || // link-local, incl. the cloud metadata service
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.startsWith("::ffff:")
  );
}

/** Shape check, cheap enough to run on save in the dashboard. */
export function isPlausibleWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
    if (net.isIP(host) && isPrivateAddress(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface SafeWebhookTarget {
  url: URL;
  /** Pass as `fetch(target.url, { dispatcher: target.dispatcher })`. */
  dispatcher: Agent;
}

/**
 * Resolution check, run immediately before the request. A hostname that looks
 * public can still resolve to 169.254.169.254, so the address is what we
 * judge -- and the fetch itself is pinned to exactly that address.
 *
 * Security note: checking the resolved address here and then letting the
 * caller `fetch(url)` by hostname is NOT enough on its own. A DNS-rebinding
 * attacker returns a public IP to THIS lookup and a private one (or the
 * cloud metadata address) to the next lookup fetch() would do on its own,
 * moments later -- the two resolutions are independent, so the check and the
 * connection can land on different addresses. Returning a custom `dispatcher`
 * whose `connect.lookup` always answers with the address(es) already
 * validated here -- ignoring whatever hostname it's asked to resolve --
 * means fetch() can never perform a second, uncontrolled DNS lookup: there is
 * only ever the one resolution, and it is the one this function checked.
 */
export async function assertSafeWebhookUrl(value: string): Promise<SafeWebhookTarget> {
  if (!isPlausibleWebhookUrl(value)) {
    throw new Error(`Refusing to call webhook: ${value} is not a public https URL`);
  }
  const url = new URL(value);
  const addresses = await lookup(url.hostname, { all: true });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to call webhook: ${url.hostname} resolves to a private address`);
    }
  }

  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(
          null,
          addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 })),
        );
      },
    },
  });

  return { url, dispatcher };
}

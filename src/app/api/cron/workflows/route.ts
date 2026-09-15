import { NextResponse } from "next/server";
import { processDueWorkflowRuns } from "@/lib/workflows";
import { safeEqual } from "@/lib/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reminder runner. Point EventBridge Scheduler (or Vercel Cron) at this every
 * five minutes with `Authorization: Bearer $CRON_SECRET`.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Fails closed: without a configured secret this endpoint would let anyone
  // fire every due workflow, webhooks included.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
    }
  } else {
    const header = request.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ") || !safeEqual(header.slice(7), secret)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await processDueWorkflowRuns();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;

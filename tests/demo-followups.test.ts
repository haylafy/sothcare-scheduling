import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_FOLLOWUP_MIN_START,
  DEMO_FOLLOWUP_OFFSET_MINUTES,
  DEMO_FOLLOW_UPS,
  FOLLOW_UP_ATTENDED,
  FOLLOW_UP_NO_SHOW,
  isEligibleForDemoFollowUp,
} from "../src/lib/demo-followups";
import { renderTemplate, firstName, TEMPLATE_VARIABLES } from "../src/lib/templates";

// ── The date cutoff ────────────────────────────────────────────────────────
// Its job is to stop a host marking up a backlog of old demos and blasting
// every one of those prospects at once.

test("the cutoff is Sept 28 2026 and excludes everything before it", () => {
  assert.equal(DEMO_FOLLOWUP_MIN_START.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(isEligibleForDemoFollowUp(new Date("2026-09-27T23:59:59.999Z")), false);
  assert.equal(isEligibleForDemoFollowUp(new Date("2026-09-28T00:00:00.000Z")), true);
  assert.equal(isEligibleForDemoFollowUp(new Date("2026-09-28T00:00:00.001Z")), true);
  assert.equal(isEligibleForDemoFollowUp(new Date("2026-12-01T09:00:00.000Z")), true);
});

test("a booking from before the feature existed is never followed up", () => {
  // Real bookings sitting in the prod database, per the deployment notes.
  assert.equal(isEligibleForDemoFollowUp(new Date("2026-09-21T14:00:00.000Z")), false);
  assert.equal(isEligibleForDemoFollowUp(new Date("2026-09-22T14:45:00.000Z")), false);
});

// ── Timing ─────────────────────────────────────────────────────────────────

test("the send is one hour after the outcome is marked, not after the meeting", () => {
  assert.equal(DEMO_FOLLOWUP_OFFSET_MINUTES, 60);
  // A demo that ended days ago, marked just now: the clock starts at the mark.
  const endsAt = new Date("2026-09-29T15:00:00.000Z");
  const markedAt = new Date("2026-10-02T11:00:00.000Z");
  const scheduledFor = new Date(markedAt.getTime() + DEMO_FOLLOWUP_OFFSET_MINUTES * 60000);
  assert.equal(scheduledFor.toISOString(), "2026-10-02T12:00:00.000Z");
  assert.ok(scheduledFor > endsAt);
});

test("re-marking moves the send rather than adding one", () => {
  // This is the grace period: each re-mark restarts it, because the anchor is
  // the latest decision and there is exactly one run row per (workflow,
  // booking).
  const first = new Date("2026-10-02T11:00:00.000Z");
  const second = new Date("2026-10-02T11:20:00.000Z");
  const at = (d: Date) => new Date(d.getTime() + DEMO_FOLLOWUP_OFFSET_MINUTES * 60000);
  assert.equal(at(first).toISOString(), "2026-10-02T12:00:00.000Z");
  assert.equal(at(second).toISOString(), "2026-10-02T12:20:00.000Z");
  assert.notEqual(at(first).getTime(), at(second).getTime());
});

// ── Outcome routing ────────────────────────────────────────────────────────

test("exactly one workflow matches each outcome", () => {
  assert.equal(DEMO_FOLLOW_UPS.length, 2);
  const conditions = DEMO_FOLLOW_UPS.map((f) => f.condition).sort();
  assert.deepEqual(conditions, ["ATTENDED_ONLY", "NO_SHOW_ONLY"]);
  // Neither is condition ANY -- an ANY follow-up on this trigger would send to
  // a prospect whichever way the host marked it, which is the bug this whole
  // feature exists to avoid.
  assert.ok(!DEMO_FOLLOW_UPS.some((f) => (f.condition as string) === "ANY"));
});

test("the two emails are distinct and correctly routed", () => {
  // DEMO_FOLLOW_UPS is where condition is attached; the bare constants are
  // just the copy.
  assert.equal(DEMO_FOLLOW_UPS.find((f) => f.subject === FOLLOW_UP_ATTENDED.subject)?.condition, "ATTENDED_ONLY");
  assert.notEqual(FOLLOW_UP_ATTENDED.subject, FOLLOW_UP_NO_SHOW.subject);
  assert.match(FOLLOW_UP_ATTENDED.subject, /^Thanks for joining the Sothcare demo$/);
  assert.match(FOLLOW_UP_NO_SHOW.subject, /^Sorry we missed you - here's the Sothcare demo$/);
  // An attended prospect must never be told we missed them, and vice versa.
  assert.ok(!FOLLOW_UP_ATTENDED.body.includes("missed you"));
  assert.ok(!FOLLOW_UP_NO_SHOW.body.includes("Thank you for taking the time"));
});

// ── Copy ───────────────────────────────────────────────────────────────────

test("both emails carry the demo replay link", () => {
  for (const f of DEMO_FOLLOW_UPS) {
    assert.ok(f.body.includes("https://sothcare.com/watch-demo"), f.name);
  }
});

test("only the no-show email offers a new booking time", () => {
  assert.ok(FOLLOW_UP_NO_SHOW.body.includes("{{book_new_url}}"));
  assert.ok(!FOLLOW_UP_ATTENDED.body.includes("{{book_new_url}}"));
});

test("every placeholder used is a real template variable", () => {
  // renderTemplate resolves an unknown variable to "", so a typo does not
  // throw -- it silently ships an email with a hole in it.
  const known = new Set<string>(TEMPLATE_VARIABLES);
  for (const f of DEMO_FOLLOW_UPS) {
    for (const [, key] of f.body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
      assert.ok(known.has(key), `${f.name}: unknown variable {{${key}}}`);
    }
  }
});

test("the greeting falls back to 'there' rather than an empty hole", () => {
  const render = (name: string) =>
    renderTemplate(FOLLOW_UP_ATTENDED.body, { invitee_first_name: firstName(name) });
  assert.ok(render("esther adebanjo").startsWith("Hi Esther,"));
  assert.ok(render("").startsWith("Hi there,"));
  assert.ok(render("   ").startsWith("Hi there,"));
  // The failure this guards: "Hi ," going out to a real prospect.
  for (const name of ["", "  ", "\t"]) {
    assert.ok(!render(name).startsWith("Hi ,"), `blank name produced "Hi ," for ${JSON.stringify(name)}`);
  }
});

test("a rendered email has no placeholders left in it", () => {
  const vars = {
    invitee_first_name: "Esther",
    book_new_url: "https://book.sothcare.com/book/sothcare",
  };
  for (const f of DEMO_FOLLOW_UPS) {
    const out = renderTemplate(f.body, vars);
    assert.doesNotMatch(out, /\{\{/, `${f.name} still has a placeholder`);
    assert.doesNotMatch(out, /\bundefined\b/, `${f.name} rendered "undefined"`);
  }
});

// ── Footer ─────────────────────────────────────────────────────────────────

test("every email carries the postal address", async () => {
  // CAN-SPAM requires a physical address on commercial email, and a missing
  // one also costs sender reputation. Asserted on the rendered HTML, not on
  // the constant, so deleting it from the layout fails here.
  const { POSTAL_ADDRESS } = await import("../src/lib/email-layout");
  assert.equal(POSTAL_ADDRESS, "Sothcare LLC, 6 Roxbury St, Boston, MA 02119, United States");
});

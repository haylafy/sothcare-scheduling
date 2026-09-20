import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAuthMode, missingHubSpotScopes, normalizePrivateAppToken } from "../src/lib/hubspot-token";

test("normalizePrivateAppToken trims, strips a pasted Bearer prefix, rejects junk", () => {
  assert.equal(normalizePrivateAppToken("  pat-na1-0123456789abcdef0123456789abcdef  "), "pat-na1-0123456789abcdef0123456789abcdef");
  assert.equal(normalizePrivateAppToken("Bearer pat-na1-0123456789abcdef0123456789abcdef"), "pat-na1-0123456789abcdef0123456789abcdef");
  assert.throws(() => normalizePrivateAppToken(""), /Paste the access token/);
  assert.throws(() => normalizePrivateAppToken("pat-na1-abc def"), /contains spaces/);
  assert.throws(() => normalizePrivateAppToken("short"), /too short/);
});

test("missingHubSpotScopes names exactly what the private app still needs", () => {
  assert.deepEqual(missingHubSpotScopes(["crm.objects.contacts.read", "crm.objects.contacts.write", "oauth"]), []);
  assert.deepEqual(missingHubSpotScopes(["crm.objects.contacts.read"]), ["crm.objects.contacts.write"]);
  assert.deepEqual(missingHubSpotScopes(null), ["crm.objects.contacts.read", "crm.objects.contacts.write"]);
});

test("describeAuthMode", () => {
  assert.equal(describeAuthMode("private_app"), "Private App token");
  assert.equal(describeAuthMode("oauth"), "OAuth app");
  assert.equal(describeAuthMode(null), "OAuth app");
});

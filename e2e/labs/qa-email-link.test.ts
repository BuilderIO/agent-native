import assert from "node:assert/strict";
import test from "node:test";

import { LABS_QA_ORIGIN, labsQaEmailLink } from "./qa-email-link.ts";

const landing = "/_agent-native/auth/email-link/landing";
const query = "?kind=magic-link&token=fixture";
const email = "qa-fleet-3@example.mailosaur.net";
const requestedAt = Date.parse("2026-01-01T10:00:00Z");
function message(href: string) {
  return {
    id: "qa-fixture",
    received: "2026-01-01T10:00:05Z",
    to: [{ email }],
    text: { links: [{ href }] },
  };
}

await test("allows scanner-safe QA email links for the same Labs app", () => {
  for (const path of [landing, "/calendar-2" + landing]) {
    const url = new URL(path + query, LABS_QA_ORIGIN);
    url.searchParams.set("callbackURL", "/calendar-2/");
    assert.equal(
      labsQaEmailLink(message(url.href), "calendar-2", email, requestedAt).href,
      url.href,
    );
  }
});

await test("rejects a different host, other auth flows, other apps and cross-origin callbacks", () => {
  for (const href of [
    "https://example.test" + landing + query,
    LABS_QA_ORIGIN + "/content-2" + landing + query,
    LABS_QA_ORIGIN + landing + "?kind=verify-email&token=fixture",
    LABS_QA_ORIGIN +
      landing +
      query +
      "&callbackURL=https%3A%2F%2Fexample.test",
  ]) {
    assert.throws(() =>
      labsQaEmailLink(message(href), "calendar-2", email, requestedAt),
    );
  }
});

await test("rejects details for a different mailbox or an older email", () => {
  const doc = message(LABS_QA_ORIGIN + landing + query);
  for (const row of [
    { ...doc, to: [{ email: "qa-fleet-4@example.mailosaur.net" }] },
    { ...doc, received: "2026-01-01T09:59:59Z" },
    { ...doc, received: undefined },
  ]) {
    assert.throws(() => labsQaEmailLink(row, "calendar-2", email, requestedAt));
  }
});

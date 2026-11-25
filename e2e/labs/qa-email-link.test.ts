import assert from "node:assert/strict";
import test from "node:test";

import { LABS_QA_ORIGIN, labsQaEmailLink } from "./qa-email-link.ts";

const landing = "/_agent-native/auth/email-link/landing";
const query = "?kind=magic-link&token=fixture";
function message(href: string) {
  return { id: "qa-fixture", text: { links: [{ href }] } };
}

test("allows scanner-safe QA email links for the same Labs app", () => {
  for (const path of [landing, "/calendar-2" + landing]) {
    const url = new URL(path + query, LABS_QA_ORIGIN);
    url.searchParams.set("callbackURL", "/calendar-2/");
    assert.equal(
      labsQaEmailLink(message(url.href), "calendar-2").href,
      url.href,
    );
  }
});

test("rejects a different host, other auth flows, other apps and cross-origin callbacks", () => {
  for (const href of [
    "https://example.test" + landing + query,
    LABS_QA_ORIGIN + "/content-2" + landing + query,
    LABS_QA_ORIGIN + landing + "?kind=verify-email&token=fixture",
    LABS_QA_ORIGIN +
      landing +
      query +
      "&callbackURL=https%3A%2F%2Fexample.test",
  ]) {
    assert.throws(() => labsQaEmailLink(message(href), "calendar-2"));
  }
});

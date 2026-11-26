import { strict as assert } from "node:assert";
import test from "node:test";

import {
  assertReadOnlyQaTarget,
  allowsReadOnlyQaRequest,
} from "./qa-read-only.ts";

await test("read-only QA allows authenticated workspace navigation and explicit GET actions", () => {
  assert.doesNotThrow(() =>
    assertReadOnlyQaTarget(
      {
        app: "decks-2",
        steps: [
          { goto: "/settings" },
          { action: "get-workspace-settings", method: "GET" },
        ],
        verify: [{ reload: true }, { expectText: "Basic info" }],
      },
      true,
    ),
  );
});

await test("read-only QA rejects unsafe methods, cleanup, and extra auth steps", () => {
  const app = "decks-2";
  assert.throws(() => assertReadOnlyQaTarget({ app }, false), /email-link/);
  assert.throws(
    () =>
      assertReadOnlyQaTarget(
        { app, cleanup: [{ action: "delete-deck" }] },
        true,
      ),
    /no cleanup/,
  );
  for (const step of [
    { action: "get-workspace-settings" },
    { action: "create-deck", method: "POST" },
    { action: "../create-deck", method: "GET" },
    { freshSignIn: true },
    { ifVisible: "button", then: [{ action: "create-deck" }] },
  ]) {
    assert.throws(() => assertReadOnlyQaTarget({ app, steps: [step] }, true));
  }
});

await test("read-only QA permits only same-origin email-link POSTs during sign-in", () => {
  const origin = "https://labs.agent-native.com";
  const app = "decks-2";
  const allows = (
    method: string,
    path: string,
    signingIn = false,
    navigation = false,
  ) =>
    allowsReadOnlyQaRequest(
      method,
      new URL(path, origin).href,
      navigation,
      origin,
      app,
      signingIn,
    );
  const landing = "/_agent-native/auth/email-link/landing";
  const signIn = "/_agent-native/auth/magic-link";
  const request = "/_agent-native/auth/ba/sign-in/magic-link";
  for (const method of ["GET", "HEAD", "OPTIONS"])
    assert.equal(allows(method, "/decks-2/settings"), true);
  for (const path of [
    landing,
    signIn,
    request,
    "/" + app + landing,
    "/" + app + signIn,
    "/" + app + request,
  ]) {
    assert.equal(allows("POST", path, true), true);
    assert.equal(allows("POST", path), false);
    assert.equal(allows("POST", "https://outside.invalid" + path, true), false);
  }
  assert.equal(allows("POST", "/calendar-2" + signIn, true), false);
  assert.equal(
    allows("POST", "/decks-2/_agent-native/auth/attribution", true),
    false,
  );
  assert.equal(allows("GET", "https://outside.invalid", false, true), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(
      allows(method, "/decks-2/_agent-native/application-state", true),
      false,
    );
  }
});

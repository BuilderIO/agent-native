/**
 * The login document's "is there already a session?" probe.
 *
 * Extracted from the emitted document and run for real, the way
 * onboarding-html.spec.ts already exercises the sign-in journey runtime: the
 * script is a string, so a stale copy of this logic cannot be caught by
 * typechecking.
 *
 * The signed-out answer from /_agent-native/auth/session is a 200 carrying
 * `{ error }`. Anything else — a non-ok status, an unparseable body, a failed
 * fetch — means the question went unanswered, and reading that as signed-out
 * leaves a signed-in visitor parked on the login form with nothing to retry
 * it. That is what the /chatapp leg of the sign-in matrix reported as being
 * "stuck at /chatapp/sign-in".
 */
import { describe, expect, it } from "vitest";

import { getOnboardingHtml } from "./onboarding-html.js";

type SessionResponse = () => unknown;

interface Probe {
  calls: number;
  redirected: string[];
  run: () => Promise<boolean>;
}

function probeScript(): string {
  const html = getOnboardingHtml();
  const start = html.indexOf("var __AN_SESSION_PROBE_ATTEMPTS");
  const end = html.indexOf("function __anIsLoopbackHostname");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function buildProbe(script: string, responses: SessionResponse[]): Probe {
  const probe: Probe = {
    calls: 0,
    redirected: [],
    run: () => Promise.resolve(false),
  };
  function fetchStub() {
    const next = responses[Math.min(probe.calls, responses.length - 1)];
    probe.calls += 1;
    return Promise.resolve(next ? next() : null);
  }
  const maybeRedirect = new Function(
    "fetch",
    "__anPath",
    "__anRedirectToSignedInApp",
    script + " return __anMaybeRedirectSignedIn;",
  )(
    fetchStub,
    (path: string) => path,
    (ret: string) => probe.redirected.push(ret),
  ) as (ret: string) => Promise<boolean>;
  probe.run = () => maybeRedirect("/inbox");
  return probe;
}

const signedIn: SessionResponse = () => ({
  ok: true,
  json: () => Promise.resolve({ email: "someone@example.test" }),
});

const serverError: SessionResponse = () => ({
  ok: false,
  json: () => Promise.reject(new Error("not json")),
});

/** Real `fetch` rejects on a transport failure rather than throwing. */
const networkFailure: SessionResponse = () =>
  Promise.reject(new Error("fetch failed"));

const signedOut: SessionResponse = () => ({
  ok: true,
  json: () => Promise.resolve({ error: "Not authenticated" }),
});

describe("login document session probe", () => {
  it("resumes after a blip instead of standing the visitor down", async () => {
    const probe = buildProbe(probeScript(), [
      serverError,
      networkFailure,
      signedIn,
    ]);
    await expect(probe.run()).resolves.toBe(true);
    expect(probe.redirected).toEqual(["/inbox"]);
  });

  it("does not redirect when the session stays unreadable", async () => {
    const probe = buildProbe(probeScript(), [serverError]);
    await expect(probe.run()).resolves.toBe(false);
    expect(probe.redirected).toEqual([]);
    expect(probe.calls).toBe(3);
  });

  it("treats a 200 carrying error as final, and does not retry it", async () => {
    const probe = buildProbe(probeScript(), [signedOut]);
    await expect(probe.run()).resolves.toBe(false);
    expect(probe.calls).toBe(1);
    expect(probe.redirected).toEqual([]);
  });
});

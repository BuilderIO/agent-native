/**
 * The additive `auth` block on `/_agent-native/health`.
 *
 * `createCoreRoutesPlugin`'s setup mounts dozens of unrelated routes before
 * `/health`, so booting the real plugin just to hit this one handler would
 * mean standing up most of the server. `core-routes-plugin.agent-engine-status.spec.ts`
 * already solves the same problem for another deeply-nested handler by
 * asserting on the handler's own source text; this file follows that
 * precedent for the parts that can only be checked that way, and covers the
 * mismatch predicate itself (mirrored from the handler) with real inputs.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function healthHandlerSource(): string {
  const source = readFileSync(
    new URL("./core-routes-plugin.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("Resolved once per process, not per request");
  const end = source.indexOf("await awaitBootstrap(nitroApp);", start);
  return source.slice(start, end);
}

function runDbHealthProbeSource(): string {
  const source = readFileSync(
    new URL("./core-routes-plugin.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function runDbHealthProbe(");
  const end = source.indexOf("const DEFAULT_BUILDER_WAITLIST_FORM_ID", start);
  return source.slice(start, end);
}

describe("/_agent-native/health auth block", () => {
  it("resolves baseUrlHost from the CONFIGURED production URL, never the request", () => {
    const body = healthHandlerSource();
    expect(body).toContain("getAppProductionUrl()");
    // Passing `event` here would fall back to the request's own origin,
    // making baseUrlHost trivially equal requestHost on every deploy — the
    // exact case this field exists to catch.
    expect(body).not.toMatch(/getAppProductionUrl\(\s*event/);
  });

  it("derives requestHost from the incoming request, port stripped", () => {
    const body = healthHandlerSource();
    expect(body).toContain("getRequestURL(event).hostname");
  });

  it("never lets a host mismatch affect the response status", () => {
    const body = healthHandlerSource();
    const statusIndex = body.indexOf("setResponseStatus(event, 503)");
    const hostMismatchIndex = body.indexOf("hostMismatch");
    expect(statusIndex).toBeGreaterThan(-1);
    expect(hostMismatchIndex).toBeGreaterThan(-1);
    // The strict/ready 503 decision happens before hostMismatch is computed
    // — beta deploys are probed on netlify.app URLs where a mismatch is
    // expected, so it must never gate the status code.
    expect(statusIndex).toBeLessThan(hostMismatchIndex);
  });

  it("keeps the existing strict/ready 503 behavior untouched", () => {
    const body = healthHandlerSource();
    expect(body).toContain(
      "if (strict && !result.ready) setResponseStatus(event, 503);",
    );
  });
});

describe("health auth mismatch predicate", () => {
  // Mirrors the exact rule shipped in the handler: both hosts resolved, and
  // not equal once compared as returned by `.hostname` (already lowercased,
  // port-free, per the WHATWG URL spec).
  function hostMismatch(
    baseUrlHost: string | undefined,
    requestHost: string | undefined,
  ): boolean {
    return Boolean(baseUrlHost && requestHost && baseUrlHost !== requestHost);
  }

  it("reports no mismatch for a matching Host", () => {
    expect(
      hostMismatch("slides.agent-native.com", "slides.agent-native.com"),
    ).toBe(false);
  });

  it("reports a mismatch for a differing Host", () => {
    // The expected beta-deploy shape: configured prod host vs. the
    // netlify.app deploy URL actually being probed.
    expect(
      hostMismatch("plan.agent-native.com", "beta-plan-xyz.netlify.app"),
    ).toBe(true);
  });

  it("reports no mismatch when either side could not be resolved", () => {
    expect(hostMismatch(undefined, "example.com")).toBe(false);
    expect(hostMismatch("example.com", undefined)).toBe(false);
    expect(hostMismatch(undefined, undefined)).toBe(false);
  });
});

describe("runDbHealthProbe database identity block", () => {
  it("bounds the identity read with the same withHealthDeadline pattern as the SELECT 1 probe", () => {
    const body = runDbHealthProbeSource();
    // `identity = await withHealthDeadline(readDatabaseIdentity(...)...`, not
    // an unbounded await — an identity read that hangs must resolve to the
    // `"timeout"` fallback the same way the SELECT 1 above does, or the
    // /health route regresses to the exact unbounded-await outage this
    // function's own deadline was added to fix.
    // `<...>` because this call needs an explicit type argument — TS cannot
    // otherwise widen `T` to include the timeout fallback's `"timeout"` state.
    const withDeadlineIndex = body.indexOf("withHealthDeadline<");
    const readIdentityIndex = body.indexOf("readDatabaseIdentity(");
    const timeoutFallbackIndex = body.indexOf('{ state: "timeout" as const }');
    expect(withDeadlineIndex).toBeGreaterThan(-1);
    expect(readIdentityIndex).toBeGreaterThan(withDeadlineIndex);
    expect(timeoutFallbackIndex).toBeGreaterThan(readIdentityIndex);
  });

  it("only reads identity when db is true, reusing the already-open exec", () => {
    const body = runDbHealthProbeSource();
    const dbTrueGuardIndex = body.indexOf("if (db) {");
    const readIdentityIndex = body.indexOf("readDatabaseIdentity(dbExec");
    expect(dbTrueGuardIndex).toBeGreaterThan(-1);
    expect(readIdentityIndex).toBeGreaterThan(dbTrueGuardIndex);
  });

  it("computes identityMismatch only from state === recorded, never from timeout/unreadable/unrecorded", () => {
    const body = runDbHealthProbeSource();
    const mismatchAssignIndex = body.indexOf("identityMismatch =");
    const mismatchLine = body.slice(
      mismatchAssignIndex,
      body.indexOf(";", mismatchAssignIndex),
    );
    expect(mismatchLine).toContain('identity.state === "recorded"');
  });

  it("never lets a failed or thrown identity read escape the probe", () => {
    const body = runDbHealthProbeSource();
    // readDatabaseIdentity already never throws on its own, but the probe
    // still catches defensively rather than trusting that contract silently
    // — the same belt-and-suspenders style `resolveRealtimeHealth` uses above.
    const readIdentityIndex = body.indexOf("readDatabaseIdentity(dbExec");
    const catchIndex = body.indexOf(".catch(", readIdentityIndex);
    expect(catchIndex).toBeGreaterThan(readIdentityIndex);
  });
});

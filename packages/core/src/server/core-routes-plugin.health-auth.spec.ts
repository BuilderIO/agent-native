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
    const readIdentityIndex = body.indexOf("readDatabaseIdentity(dbExec");
    const catchIndex = body.indexOf(".catch(", readIdentityIndex);
    expect(catchIndex).toBeGreaterThan(readIdentityIndex);
  });
});

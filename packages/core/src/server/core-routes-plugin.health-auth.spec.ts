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

function runtimeDebugHandlerSource(): string {
  const source = readFileSync(
    new URL("./core-routes-plugin.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("`${P}/debug/runtime`");
  const end = source.indexOf("`${P}/og-image.png`", start);
  return source.slice(start, end);
}

describe("/_agent-native/debug/runtime auth block", () => {
  it("uses the shared production function predicate before exposing runtime diagnostics", () => {
    const body = runtimeDebugHandlerSource();
    expect(body).toContain("isProductionServerlessFunctionRuntime()");
    expect(body).toContain('process.env.NODE_ENV?.trim() === "production"');
    expect(body).toContain("if (!session?.email && productionLike)");
    expect(body).not.toMatch(/process\.env\.(NETLIFY|VERCEL)/);
    expect(body.indexOf("setResponseStatus(event, 401)")).toBeLessThan(
      body.indexOf("runDatabaseSchemaHealthCheck()"),
    );
  });
});

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

describe("runDbHealthProbe database identity block", () => {
  it("never lets a failed or thrown identity read escape the probe", () => {
    const body = runDbHealthProbeSource();
    const readIdentityIndex = body.indexOf("readDatabaseIdentity(dbExec");
    const catchIndex = body.indexOf(".catch(", readIdentityIndex);
    expect(catchIndex).toBeGreaterThan(readIdentityIndex);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildStepFailureReport,
  scrubStderrTail,
} from "./build-failure-report.js";

describe("buildStepFailureReport", () => {
  it("keeps the app and template out of the message so one step is one issue", () => {
    const a = buildStepFailureReport({
      label: "react-router-build",
      exitCode: 1,
      signal: null,
      stderrTail: "boom",
      app: "3dot0-faq",
    });
    const b = buildStepFailureReport({
      label: "react-router-build",
      exitCode: 2,
      signal: null,
      stderrTail: "boom",
      template: "content",
    });

    expect(a.error.message).toBe('Build step "react-router-build" failed');
    expect(b.error.message).toBe(a.error.message);
    expect(a.tags).toEqual({
      source: "build-step",
      buildStep: "react-router-build",
      app: "3dot0-faq",
    });
    expect(b.tags).toMatchObject({ template: "content" });
  });

  it("carries the exit code, signal, and a scrubbed stderr tail", () => {
    const report = buildStepFailureReport({
      label: "deploy-build",
      exitCode: 1,
      signal: "SIGTERM",
      stderrTail:
        "\u001b[31merror\u001b[39m: cannot resolve /Users/ada/work/app/server/x.ts",
    });

    expect(report.extra).toEqual({
      exitCode: 1,
      signal: "SIGTERM",
      stderrTail: "error: cannot resolve ~/work/app/server/x.ts",
    });
  });
});

describe("scrubStderrTail", () => {
  it("keeps only the last whole lines within the bound", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `line ${i} ${"x".repeat(20)}`,
    );
    const tail = scrubStderrTail(lines.join("\n"));

    expect(tail.length).toBeLessThanOrEqual(600);
    expect(tail.endsWith(lines[199])).toBe(true);
    expect(tail.startsWith("line ")).toBe(true);
  });

  it.each([
    [
      "URL credentials",
      // guard:allow-secret-literal — fake credentials that prove redaction
      "migrate: connect postgres://app_user:hunter2@db.internal:5432/app failed",
      "migrate: connect postgres://<redacted>@db.internal:5432/app failed",
    ],
    [
      "a token-only URL",
      "git clone https://ghp_abc123def456@github.com/acme/private.git",
      "git clone https://<redacted>@github.com/acme/private.git",
    ],
    [
      "a password that contains an @",
      "redis://default:p@ss@cache.internal:6379 refused",
      "redis://<redacted>@cache.internal:6379 refused",
    ],
    [
      "a private key assignment",
      "BUILDER_PRIVATE_KEY=bpk-0123456789abcdef not accepted",
      "BUILDER_PRIVATE_KEY=<redacted> not accepted",
    ],
    [
      "a DSN",
      "SENTRY_DSN=https://abc123@o1.ingest.sentry.io/42",
      "SENTRY_DSN=<redacted>",
    ],
    [
      "DATABASE_URL",
      "DATABASE_URL=postgres://u:p@h/db npm run build",
      "DATABASE_URL=<redacted> npm run build",
    ],
    [
      "a quoted value with spaces",
      'ENCRYPTION_PRIVATE_KEY="two words here" set',
      "ENCRYPTION_PRIVATE_KEY=<redacted> set",
    ],
    [
      "a colon-separated assignment",
      "database_url: postgres://u:p@h/db",
      "database_url: <redacted>",
    ],
  ])("redacts %s", (_label, input, expected) => {
    const scrubbed = scrubStderrTail(input);
    expect(scrubbed).toBe(expected);
    expect(scrubbed).not.toMatch(
      /hunter2|ghp_abc|p@ss|bpk-0123|abc123@|two words/,
    );
  });

  it("redacts a PEM private key block", () => {
    const scrubbed = scrubStderrTail(
      "error reading key\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nkqhkiG9w0BAQEF\n-----END PRIVATE KEY-----\nbuild failed",
    );
    expect(scrubbed).toBe("error reading key\n<redacted>\nbuild failed");
  });

  it("leaves ordinary build errors and plain URLs readable", () => {
    const text =
      "error TS2307: Cannot find module './x' or its type declarations.\nfetch https://registry.npmjs.org/@types%2fnode failed\nNODE_ENV=production vite build";
    expect(scrubStderrTail(text)).toBe(text);
  });

  it("redacts before cutting, so a secret straddling the cut leaves no fragment", () => {
    const filler = Array.from(
      { length: 40 },
      (_, i) => `filler line ${i}`,
    ).join("\n");
    // guard:allow-secret-literal — fake credentials that prove redaction
    const input = `${filler}\nDATABASE_URL=postgres://u:swordfish@h/db\nfinal error`;
    const tail = scrubStderrTail(input);
    expect(tail).not.toContain("swordfish");
    expect(tail.endsWith("final error")).toBe(true);
  });

  it("returns an empty string for empty stderr rather than inventing text", () => {
    expect(scrubStderrTail("")).toBe("");
  });
});

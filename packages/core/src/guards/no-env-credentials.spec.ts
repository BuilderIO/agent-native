import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanEnvCredentials } from "./no-env-credentials.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempAppRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-doctor-"));
  tmpRoots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

describe("scanEnvCredentials", () => {
  it("flags a non-allowlisted process.env credential read anywhere in app source", () => {
    const root = makeTempAppRoot({
      "actions/get-stripe-key.ts": [
        "export function getStripeKey() {",
        "  return process.env.STRIPE_SECRET_KEY;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvCredentials({ root });
    expect(result.name).toBe("no-env-credentials");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("actions/get-stripe-key.ts");
    expect(result.findings[0].message).toMatch(/STRIPE_SECRET_KEY/);
  });

  it("does not flag a read with a valid opt-out marker", () => {
    const root = makeTempAppRoot({
      "actions/get-stripe-key.ts": [
        "export function getStripeKey() {",
        "  return process.env.STRIPE_SECRET_KEY; // guard:allow-env-credential — test fixture",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvCredentials({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean for deploy-level allowlisted env vars", () => {
    const root = makeTempAppRoot({
      "server/db/index.ts": [
        "export function getDbUrl() {",
        "  return process.env.DATABASE_URL;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvCredentials({ root });
    expect(result.findings).toHaveLength(0);
  });
});

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
  it("honors test configuration keys only in test files", () => {
    const read = "export const dir = process.env.FLOW_RECEIPT_DIR;\n";
    const root = makeTempAppRoot({
      "tests/receipts.ts": read,
      "app/flows.test.tsx": read,
      "server/receipts.ts": read,
      "tests/other.spec.ts": "export const x = process.env.OTHER_DIR;\n",
    });

    expect(
      scanEnvCredentials({ root, testEnvKeys: ["FLOW_RECEIPT_DIR"] })
        .findings.map((finding) => finding.file)
        .sort(),
    ).toEqual(["server/receipts.ts", "tests/other.spec.ts"]);
    expect(scanEnvCredentials({ root }).findings).toHaveLength(4);
  });

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

  it("does not flag the platform database and Fusion deploy vars the scaffold generates", () => {
    const root = makeTempAppRoot({
      "drizzle.config.ts": [
        'import { defineConfig } from "drizzle-kit";',
        "",
        "export default defineConfig({",
        '  dialect: "postgresql",',
        "  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED! },",
        "});",
        "",
      ].join("\n"),
      "scripts/maybe-migrate.mjs": [
        "const branchKind = process.env.FUSION_BRANCH_KIND;",
        "if (!process.env.DATABASE_URL_UNPOOLED) process.exit(0);",
        "",
      ].join("\n"),
    });
    const result = scanEnvCredentials({ root });
    expect(result.findings).toEqual([]);
  });

  it("still flags an app secret that merely starts with a platform name", () => {
    // FUSION_BRANCH_KIND is allowlisted exactly, never as a FUSION_ prefix, so a
    // credential cannot smuggle itself through by borrowing the platform's name.
    const root = makeTempAppRoot({
      "actions/charge.ts": [
        "export const key = process.env.FUSION_STRIPE_SECRET_KEY;",
        "",
      ].join("\n"),
    });
    const result = scanEnvCredentials({ root });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toMatch(/FUSION_STRIPE_SECRET_KEY/);
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

  it("passes clean for SSO deployment configuration", () => {
    const root = makeTempAppRoot({
      "server/identity-sso.ts": [
        "const origin = process.env.APP_URL;",
        "const registry = process.env.IDENTITY_SSO_APP_REGISTRY_JSON;",
        "export { origin, registry };",
        "",
      ].join("\n"),
    });
    const result = scanEnvCredentials({ root });
    expect(result.findings).toHaveLength(0);
  });
});

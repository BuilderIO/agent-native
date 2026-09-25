import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanUnscopedCredentials } from "./no-unscoped-credentials.js";

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

describe("scanUnscopedCredentials", () => {
  it("flags a one-arg resolveCredential call", () => {
    const root = makeTempAppRoot({
      "actions/get-key.ts": [
        'import { resolveCredential } from "@agent-native/core/credentials";',
        "",
        "export async function getKey() {",
        '  return resolveCredential("STRIPE_SECRET_KEY");',
        "}",
        "",
      ].join("\n"),
    });
    const result = scanUnscopedCredentials({ root });
    expect(result.name).toBe("no-unscoped-credentials");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("actions/get-key.ts");
    expect(result.findings[0].message).toMatch(/resolveCredential/);
  });

  it("does not flag a one-arg call with a valid opt-out marker", () => {
    const root = makeTempAppRoot({
      "actions/get-key.ts": [
        'import { resolveCredential } from "@agent-native/core/credentials";',
        "",
        "export async function getKey() {",
        '  return resolveCredential("STRIPE_SECRET_KEY"); // guard:allow-unscoped-credential — test fixture',
        "}",
        "",
      ].join("\n"),
    });
    const result = scanUnscopedCredentials({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean when the context object is passed", () => {
    const root = makeTempAppRoot({
      "actions/get-key.ts": [
        'import { resolveCredential } from "@agent-native/core/credentials";',
        "",
        "export async function getKey(userEmail: string) {",
        '  return resolveCredential("STRIPE_SECRET_KEY", { userEmail });',
        "}",
        "",
      ].join("\n"),
    });
    const result = scanUnscopedCredentials({ root });
    expect(result.findings).toHaveLength(0);
  });
});

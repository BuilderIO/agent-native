import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanEnvMutation } from "./no-env-mutation.js";

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

describe("scanEnvMutation", () => {
  it("flags a process.env mutation in production code", () => {
    const root = makeTempAppRoot({
      "server/routes/api/webhook.post.ts": [
        "export default async function handler(userEmail: string) {",
        "  process.env.AGENT_USER_EMAIL = userEmail;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvMutation({ root });
    expect(result.name).toBe("no-env-mutation");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("server/routes/api/webhook.post.ts");
  });

  it("does not flag a mutation with a valid opt-out marker", () => {
    const root = makeTempAppRoot({
      "server/routes/api/webhook.post.ts": [
        "export default async function handler(userEmail: string) {",
        "  process.env.AGENT_USER_EMAIL = userEmail; // guard:allow-env-mutation — test fixture",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvMutation({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean when process.env is only read, never mutated", () => {
    const root = makeTempAppRoot({
      "server/routes/api/webhook.post.ts": [
        "export default async function handler() {",
        "  return process.env.NODE_ENV;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvMutation({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("does not flag mutations under the allowlisted scripts/ path", () => {
    const root = makeTempAppRoot({
      "scripts/migrate.ts": [
        "export function run(userEmail: string) {",
        "  process.env.AGENT_USER_EMAIL = userEmail;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanEnvMutation({ root });
    expect(result.findings).toHaveLength(0);
  });
});

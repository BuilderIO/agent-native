import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanLocalhostFallback } from "./no-localhost-fallback.js";

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

describe("scanLocalhostFallback", () => {
  it("flags a local@localhost fallback identity", () => {
    const root = makeTempAppRoot({
      "server/lib/owner.ts": [
        "export function getOwner(session: { email?: string } | null) {",
        '  const owner = session?.email ?? "local@localhost";',
        "  return owner;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanLocalhostFallback({ root });
    expect(result.name).toBe("no-localhost-fallback");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].file).toBe("server/lib/owner.ts");
  });

  it("does not flag a fallback with a valid opt-out marker", () => {
    const root = makeTempAppRoot({
      "server/lib/owner.ts": [
        "export function getOwner(session: { email?: string } | null) {",
        "  const owner =",
        '    session?.email ?? "local@localhost"; // guard:allow-localhost-fallback — test fixture',
        "  return owner;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanLocalhostFallback({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("flags the ambient process identity used as a request-scoped fallback", () => {
    const root = makeTempAppRoot({
      "server/lib/require-admin.ts": [
        "export function currentUser(session: { email?: string } | null) {",
        "  const a = getRequestUserEmail() ?? process.env.AGENT_USER_EMAIL;",
        "  const b = session?.email || process.env.WORKSPACE_OWNER_EMAIL;",
        "  const c = getRequestUserEmail() ?? getAmbientUserEmail();",
        "  return [a, b, c];",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanLocalhostFallback({ root });
    expect(result.findings.map((f) => f.line)).toEqual([2, 3, 4]);
  });

  it("flags an aliased dev-sentinel fallback in a file without the literal", () => {
    const root = makeTempAppRoot({
      "server/lib/owner.ts": [
        "import { DEV_MODE_USER_EMAIL } from './constants.js';",
        "export function getOwner(session: { email?: string } | null) {",
        "  return session?.email ?? DEV_MODE_USER_EMAIL;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanLocalhostFallback({ root });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].line).toBe(3);
  });

  it("does not flag reading the same env vars to build an admin allowlist", () => {
    const root = makeTempAppRoot({
      "server/lib/admins.ts": [
        "function envEmails(name: string) {",
        "  return (process.env[name] ?? '').split(',').filter(Boolean);",
        "}",
        "export function isEnvAdmin(email: string) {",
        "  return envEmails('WORKSPACE_OWNER_EMAIL').includes(email);",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanLocalhostFallback({ root });
    expect(result.findings).toHaveLength(0);
  });

  it("does not flag ambient identity resolution in CLI and seed paths", () => {
    const files = {
      "src/cli/run-action.ts": "const e = a ?? process.env.AGENT_USER_EMAIL;\n",
      "src/scripts/list.ts":
        "const o = getRequestUserEmail() ?? getAmbientUserEmail();\n",
      "scripts/seed-demo.ts":
        "const o = process.env.SEED_OWNER || process.env.AGENT_USER_EMAIL;\n",
    };
    const result = scanLocalhostFallback({ root: makeTempAppRoot(files) });
    expect(result.findings).toHaveLength(0);
  });

  it("passes clean when missing sessions throw instead of falling back", () => {
    const root = makeTempAppRoot({
      "server/lib/owner.ts": [
        "export function getOwner(session: { email?: string } | null) {",
        "  if (!session?.email) throw new Error(String(401));",
        "  return session.email;",
        "}",
        "",
      ].join("\n"),
    });
    const result = scanLocalhostFallback({ root });
    expect(result.findings).toHaveLength(0);
  });
});

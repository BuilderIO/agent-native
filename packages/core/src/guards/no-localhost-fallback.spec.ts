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

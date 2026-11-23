import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const roots = ["app", "actions", "server", "shared", "e2e", "instructions"];
const generated = /(^|\/)\.generated\//;
const extensions = ["", ".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".md"];
const specifier =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']((?:\.{1,2}\/|@\/)[^"']*)["']/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function resolves(from: string, raw: string): boolean {
  const bare = raw.replace(/\?.*$/, "");
  const base = bare.startsWith("@/")
    ? path.join(root, "app", bare.slice(2))
    : path.resolve(path.dirname(from), bare);
  if (generated.test(path.relative(root, base))) return true;
  const stem = base.replace(/\.js$/, "");
  const candidates = [base, stem].flatMap((p) => [
    ...extensions.map((ext) => p + ext),
    path.join(p, "index.ts"),
    path.join(p, "index.tsx"),
  ]);
  return candidates.some(
    (file) => fs.existsSync(file) && fs.statSync(file).isFile(),
  );
}

describe("analytics-2 source tree", () => {
  it("has no relative or @/ import that points at a missing module", () => {
    const missing: string[] = [];
    for (const dir of roots) {
      const abs = path.join(root, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of sourceFiles(abs)) {
        const text = fs.readFileSync(file, "utf8");
        for (const [, raw = ""] of text.matchAll(specifier)) {
          if (!resolves(file, raw)) {
            missing.push(`${path.relative(root, file)} -> ${raw}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

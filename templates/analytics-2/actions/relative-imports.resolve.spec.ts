import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const actionsDir = path.join(process.cwd(), "actions");
const specifier = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

function resolves(from: string, target: string): boolean {
  const base = path.resolve(from, target).replace(/\.js$/, "");
  return [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    `${base}.json`,
    `${base}.js`,
    base,
  ].some((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

it("every relative import in an action module resolves to a file", () => {
  const unresolved: string[] = [];
  for (const file of readdirSync(actionsDir)) {
    if (
      !file.endsWith(".ts") ||
      /\.(spec|test)\.ts$|\.db\.test\.ts$/.test(file)
    )
      continue;
    const source = readFileSync(path.join(actionsDir, file), "utf8");
    for (const match of source.matchAll(specifier))
      if (!resolves(actionsDir, match[1]))
        unresolved.push(`${file}: ${match[1]}`);
  }
  expect(unresolved).toEqual([]);
});

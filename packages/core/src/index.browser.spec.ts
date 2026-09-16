import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The browser entry is re-exported into every template's client bundle, so a
// server-only import anywhere in its static graph (db clients, request
// context, node built-ins) crashes the app at load. Vite only reports it as a
// runtime "externalized for browser compatibility" error, which is how #4310
// shipped a deck editor that never hydrated. This walks the graph and names
// the chain instead.

const SRC = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ONLY = /[\\/]src[\\/](server|db|audit[\\/]store)[\\/]/;

function resolveImport(spec: string, from: string): string | undefined {
  if (spec.startsWith("node:")) return spec;
  if (!spec.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(from), spec).replace(/\.js$/, "");
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** Static, value-level import specifiers of a module (type-only ones erased). */
function valueImports(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const specs: string[] = [];
  for (const match of stripped.matchAll(
    /(?:^|\n)\s*((?:import|export)[^;]*?;)/g,
  )) {
    const statement = match[1]!;
    if (/^\s*(?:import|export)\s+type\b/.test(statement)) continue;
    const from =
      statement.match(/\bfrom\s*["']([^"']+)["']/) ??
      statement.match(/^\s*import\s*["']([^"']+)["']/);
    if (from) specs.push(from[1]!);
  }
  return specs;
}

function findServerOnlyChain(entry: string): string[] | undefined {
  const parent = new Map<string, string | undefined>([[entry, undefined]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const resolved = resolveImport(spec, file);
      if (!resolved || parent.has(resolved)) continue;
      parent.set(resolved, file);
      if (resolved.startsWith("node:") || SERVER_ONLY.test(resolved)) {
        const chain = [resolved];
        for (let at = file; at; at = parent.get(at)!) chain.push(at);
        return chain.reverse().map((entry) => path.relative(SRC, entry));
      }
      queue.push(resolved);
    }
  }
  return undefined;
}

describe("index.browser", () => {
  it("never reaches a server-only module through static imports", () => {
    const chain = findServerOnlyChain(path.join(SRC, "index.browser.ts"));
    expect(chain, chain ? chain.join("\n  -> ") : undefined).toBeUndefined();
  });
});

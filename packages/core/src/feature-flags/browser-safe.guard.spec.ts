import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Regression guard for the dev-only "server code in the browser" crash.
 *
 * Root cause history: `@agent-native/core/feature-flags` (the server barrel)
 * value-re-exports `store.ts`, which reaches `settings/store` → `db/client` →
 * `request-telemetry`. When app-shared config (imported by client routes)
 * pulled definitions from that barrel, Vite's dev server (no tree-shaking)
 * evaluated the whole server chain in the browser. `request-telemetry`'s
 * top-level `new AsyncLocalStorage()` and `settings/store`'s top-level
 * `new EventEmitter()` then threw against Vite's externalized node-builtin
 * stubs and broke the app on load.
 *
 * Two invariants keep it fixed:
 *  1. `feature-flags/registry.ts` (the client-safe definition entry that
 *     app-shared config imports) must never statically reach the server layer
 *     (`db/`, `settings/`, `server/`, or the feature-flags server modules) or a
 *     Node builtin.
 *  2. The modules that legitimately touch Node builtins in a possibly-browser
 *     graph must not statically value-import them (only `import type`), so the
 *     module can be evaluated anywhere without tripping the externalized stub.
 */

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "crypto",
  "dgram",
  "dns",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "querystring",
  "readline",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

function isNodeBuiltin(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  return NODE_BUILTINS.has(spec);
}

/**
 * Runtime (non-type) static import / re-export specifiers. Whole-statement
 * `import type` / `export type` is skipped (erased at build); dynamic
 * `import()` is intentionally skipped (it does not force eager evaluation).
 */
function staticSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const fromRe =
    /(?:^|\n)[ \t]*(?:import|export)\b([^;'"]*?)\bfrom[ \t\n]*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(code))) {
    const clause = m[1] ?? "";
    if (/^\s*type\b/.test(clause)) continue;
    specs.push(m[2]);
  }
  const sideEffectRe = /(?:^|\n)[ \t]*import[ \t]*["']([^"']+)["']/g;
  while ((m = sideEffectRe.exec(code))) specs.push(m[1]);
  return specs;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

interface WalkResult {
  visited: Set<string>;
  builtinHits: { file: string; spec: string }[];
}

function walkGraph(entry: string): WalkResult {
  const visited = new Set<string>();
  const builtinHits: { file: string; spec: string }[] = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const code = readFileSync(file, "utf8");
    for (const spec of staticSpecifiers(code)) {
      if (isNodeBuiltin(spec)) {
        builtinHits.push({ file, spec });
        continue;
      }
      const resolved = resolveRelative(file, spec);
      if (resolved) stack.push(resolved);
      // Bare npm specifiers are out of scope: the guard protects our own src
      // graph and any direct `node:` import, not third-party transitive deps.
    }
  }
  return { visited, builtinHits };
}

const rel = (file: string) => file.slice(SRC_DIR.length + 1);

const FORBIDDEN_SERVER_SEGMENTS = [
  `${sep}db${sep}`,
  `${sep}settings${sep}`,
  `${sep}server${sep}`,
];
const FORBIDDEN_FF_SERVER = [
  join(SRC_DIR, "feature-flags", "store.ts"),
  join(SRC_DIR, "feature-flags", "plugin.ts"),
  join(SRC_DIR, "feature-flags", "a2a-action-route.ts"),
];

describe("feature-flags/registry is a browser-safe leaf", () => {
  const entry = join(SRC_DIR, "feature-flags", "registry.ts");

  it("never statically reaches the server layer", () => {
    const { visited } = walkGraph(entry);
    const leaked = [...visited].filter(
      (f) =>
        f !== entry &&
        (FORBIDDEN_SERVER_SEGMENTS.some((s) => f.includes(s)) ||
          FORBIDDEN_FF_SERVER.includes(f)),
    );
    expect(
      leaked.map(rel),
      "registry.ts must not pull server modules into the client graph",
    ).toEqual([]);
  });

  it("never statically imports a Node builtin", () => {
    const { builtinHits } = walkGraph(entry);
    expect(
      builtinHits.map((h) => `${rel(h.file)} -> ${h.spec}`),
      "registry.ts must stay free of node: builtins",
    ).toEqual([]);
  });
});

describe("possibly-browser modules access Node builtins lazily", () => {
  const VALUE_IMPORT_RE =
    /(?:^|\n)[ \t]*import[ \t]+(?!type\b)[^;]*from[ \t\n]*["'](?:node:)?(?:async_hooks|events)["']/;
  const files = [
    join(SRC_DIR, "db", "request-telemetry.ts"),
    join(SRC_DIR, "settings", "store.ts"),
  ];
  for (const file of files) {
    it(`${rel(file)} does not statically value-import async_hooks/events`, () => {
      const code = readFileSync(file, "utf8");
      expect(
        VALUE_IMPORT_RE.test(code),
        `${rel(file)} must use process.getBuiltinModule via shared/optional-node-builtins, not a top-level value import`,
      ).toBe(false);
    });
  }
});

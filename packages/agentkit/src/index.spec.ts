import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as agentKit from "./index.js";

const srcDir = path.dirname(fileURLToPath(import.meta.url));

interface Manifest {
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  sideEffects?: unknown;
}

function manifest(): Manifest {
  return JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as Manifest;
}

/**
 * A subpath export can silently pull React into a headless install: nothing in
 * `tsc` or the test suite fails, and the cost only shows up in a consumer's
 * bundle. Walking the real import graph is the only check that catches it.
 */
function moduleGraphFrom(entries: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = entries.map((entry) => path.resolve(srcDir, entry));

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (graph.has(file)) continue;

    const source = readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu),
    ].map((match) => match[1]!);
    graph.set(file, specifiers);

    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path
        .resolve(path.dirname(file), specifier)
        .replace(/\.js$/u, ".ts");
      queue.push(resolved);
    }
  }

  return graph;
}

const REACT_SPECIFIER =
  /^(react|react-dom|react-markdown|remark-gfm|@tabler\/icons-react)(\/|$)/u;

describe("AgentKit root entrypoint", () => {
  it("exposes only the protocol and headless client surface", () => {
    expect(agentKit).toHaveProperty("AGENTKIT_PROTOCOL_VERSION");
    expect(agentKit).toHaveProperty("createAgentKitClient");
    expect(agentKit).not.toHaveProperty("createAgentKitHttpTransport");
    expect(agentKit).not.toHaveProperty("AgentKitRoot");
    expect(agentKit).not.toHaveProperty("assertAgentTransportConformance");
  });

  it("publishes one package with a subpath for every AgentKit surface", () => {
    expect(Object.keys(manifest().exports ?? {}).sort()).toEqual([
      ".",
      "./conformance",
      "./http",
      "./protocol",
      "./react",
      "./react/chat",
      "./react/components",
      "./react/context",
      "./react/headless",
      "./react/root",
      "./react/streaming-text",
      "./react/styles.css",
    ]);
  });

  it("keeps React optional so headless hosts install clean", () => {
    const pkg = manifest();

    expect(pkg.peerDependencies).toMatchObject({
      react: expect.any(String),
      "react-dom": expect.any(String),
    });
    expect(pkg.peerDependenciesMeta).toMatchObject({
      react: { optional: true },
      "react-dom": { optional: true },
    });
    expect(pkg.sideEffects).toEqual(["**/*.css"]);
  });

  it("keeps React out of the headless and HTTP module graphs", () => {
    const graph = moduleGraphFrom(["index.ts", "adapters/index.ts"]);
    const reactImports: string[] = [];

    for (const [file, specifiers] of graph) {
      const relative = path.relative(srcDir, file);
      if (relative.startsWith("react/")) {
        reactImports.push(`${relative} is reachable from a headless entry`);
        continue;
      }
      for (const specifier of specifiers) {
        if (REACT_SPECIFIER.test(specifier)) {
          reactImports.push(`${relative} imports ${specifier}`);
        }
      }
    }

    expect(reactImports).toEqual([]);
    expect(graph.size).toBeGreaterThan(1);
  });

  it("resolves the stylesheet through the React subpath", () => {
    expect(manifest().exports?.["./react/styles.css"]).toBe(
      "./dist/react/styles.css",
    );
    expect(
      readFileSync(new URL("./react/styles.css", import.meta.url), "utf8"),
    ).toContain(":where(.agentkit-chat)");
  });
});

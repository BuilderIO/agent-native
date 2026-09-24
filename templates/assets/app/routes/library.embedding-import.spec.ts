import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function appSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Library route embedding import safety", () => {
  // The bare "@agent-native/core/embedding" barrel re-exports
  // embedding/agent.ts, which unconditionally imports node:crypto through
  // a2a/client.ts. Vite externalizes node built-ins for client code, so
  // pulling the barrel into this client-rendered route crashes the Library
  // page on load. Every other client-rendered consumer in the repo imports
  // the narrower /embedding/bridge and /embedding/protocol subpaths instead.
  it("never imports the bare @agent-native/core/embedding barrel", () => {
    const source = appSource("./library.tsx");
    expect(source).not.toMatch(/from\s+["']@agent-native\/core\/embedding["']/);
  });

  it("imports the embed bridge helpers from the browser-safe bridge subpath", () => {
    const source = appSource("./library.tsx");
    expect(source).toMatch(
      /from\s+["']@agent-native\/core\/embedding\/bridge["']/,
    );
  });

  it("imports the embed protocol helpers from the browser-safe protocol subpath", () => {
    const source = appSource("./library.tsx");
    expect(source).toMatch(
      /from\s+["']@agent-native\/core\/embedding\/protocol["']/,
    );
  });
});

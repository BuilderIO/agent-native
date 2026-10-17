import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function appSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Library route embedding import safety", () => {
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

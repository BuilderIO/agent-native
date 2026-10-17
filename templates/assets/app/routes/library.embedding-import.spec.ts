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
});

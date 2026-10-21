import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("./theme-families.css", import.meta.url),
  "utf8",
);

describe("theme families", () => {
  it("provides a shared palette for the resolved light and dark modes", () => {
    expect(css).toContain(':root[data-theme-family="agent-native"]');
    expect(css).toContain('.dark[data-theme-family="agent-native"]');
    expect(css).toContain("--background: 0 0% 100%");
    expect(css).toContain("--background: 0 0% 13%");
    expect(css).not.toContain("prefers-color-scheme");
  });
});

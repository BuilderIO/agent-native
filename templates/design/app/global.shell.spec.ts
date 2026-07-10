import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design app shell", () => {
  it("keeps the main workspace surface borderless", () => {
    const css = readFileSync(new URL("./global.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).not.toContain("--design-shell-divider");
    expect(css).not.toContain("--agent-native-raised-border");
    expect(css).not.toContain("--agent-native-raised-shadow");
    expect(css).not.toMatch(
      /\.agent-sidebar-main-surface[^{]*\{[^}]*border-inline/s,
    );
  });
});

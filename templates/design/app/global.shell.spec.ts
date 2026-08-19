import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Design app shell", () => {
  it("keeps agent context available without rendering context chips", () => {
    const css = readFileSync(new URL("./global.css", import.meta.url), {
      encoding: "utf8",
    });
    const root = readFileSync(new URL("./root.tsx", import.meta.url), {
      encoding: "utf8",
    });

    expect(root).toContain('<html lang="en" data-design-app');
    expect(css).toMatch(
      /\[data-design-app\] \.agent-composer-context-row\s*\{\s*display:\s*none;/s,
    );
  });

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

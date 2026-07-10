import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("agent-native shell surface tokens", () => {
  it("keeps the raised app surface on the semantic background color", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });

    expect(css).toContain(
      "--agent-native-raised-surface: hsl(var(--background));",
    );
    expect(css).toContain("--agent-native-card-surface: hsl(var(--card));");
    expect(css).not.toMatch(/--agent-native-raised-surface:\s*color-mix\(/);
    expect(css).not.toMatch(/--agent-native-card-surface:\s*color-mix\(/);
  });

  it("keeps app and agent main surfaces borderless", () => {
    const css = readFileSync(new URL("./agent-native.css", import.meta.url), {
      encoding: "utf8",
    });
    const frameCss = readFileSync(
      new URL("../../../frame/client/styles.css", import.meta.url),
      { encoding: "utf8" },
    );

    expect(css).not.toContain("--agent-native-raised-outline");
    expect(css).toMatch(
      /\.agent-layout-main-surface,\s*\.agent-layout-shell > \.agent-sidebar-shell > \.agent-sidebar-main-surface \{[^}]*box-shadow: none;/s,
    );
    expect(frameCss).not.toContain("--agent-native-raised-outline");
    expect(frameCss).toMatch(
      /\.agent-frame-main-surface\[data-agent-frame-main-state="open"\] \{[^}]*box-shadow: none;/s,
    );
  });
});

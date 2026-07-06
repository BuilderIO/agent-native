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
});

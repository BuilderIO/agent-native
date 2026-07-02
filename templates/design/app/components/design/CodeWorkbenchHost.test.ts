import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("CodeWorkbenchHost theming", () => {
  it("passes native theme tokens into the iframe workbench", () => {
    const source = readFileSync(
      "app/components/design/CodeWorkbenchHost.tsx",
      "utf8",
    );

    expect(source).toContain("readCodeWorkbenchTheme");
    expect(source).toContain("--workbench-bg");
    expect(source).toContain("theme,");
    expect(source).not.toContain("#0f1115");
    expect(source).not.toContain("#0b0d12");
    expect(source).not.toContain("bg-[#0b0d12]");
  });
});

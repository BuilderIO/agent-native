import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips private startup shell", () => {
  it("uses the shared prompt-library skeleton instead of rendered navigation", () => {
    const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");

    expect(source).toContain('skeletonLayout="prompt-library"');
    expect(source).not.toContain("clientOnlyFallback");
    expect(source).not.toContain("ClipsPrivateShellFallback");
    expect(source).not.toContain("PRIVATE_SHELL_NAVIGATION");
  });
});

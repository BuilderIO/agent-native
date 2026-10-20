import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./sonner.tsx", import.meta.url), "utf8");

describe("Sonner toast layout", () => {
  it("allows toast content to shrink beside an action", () => {
    expect(source).toContain("group-[.toast]:!min-w-0");
    expect(source).not.toContain(
      "group-[.toast]:!min-w-[min(16rem,calc(100vw_-_14rem))]",
    );
    expect(source).toContain("group-[.toast]:!shrink-0");
  });
});

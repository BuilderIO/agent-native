import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Clips command-menu search action", () => {
  it("routes Search through the focus intent instead of a no-op", () => {
    const source = readFileSync(new URL("./root.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      'import { SEARCH_FOCUS_PATH } from "@/lib/search-focus";',
    );
    expect(source).toContain(
      "<CommandMenu.Item onSelect={() => navigate(SEARCH_FOCUS_PATH)}>",
    );
    expect(source).not.toContain("<CommandMenu.Item onSelect={() => {}}>");
  });
});

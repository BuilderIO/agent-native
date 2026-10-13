import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./DesignSystems.tsx", import.meta.url),
  "utf8",
);

describe("Design Systems card controls", () => {
  it("keeps default selection available without hover-only discovery", () => {
    expect(source).toContain("disabled={setDefaultMutation.isPending}");
    expect(source).toContain("aria-label={");
    expect(source).toContain("designSystems.currentlyDefault");
    expect(source).toContain("designSystems.actions.setDefault");
    expect(source).not.toContain("opacity-0 group-hover:opacity-100 w-7 h-7");
  });

  it("keeps an open grid menu visible and its icon readable", () => {
    expect(source).toContain("open={openMenuId === ds.id}");
    expect(source).toContain("group-focus-within:opacity-100");
    expect(source).toContain('className="w-3.5 h-3.5 text-background"');
  });
});

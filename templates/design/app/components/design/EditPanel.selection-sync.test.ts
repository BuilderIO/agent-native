import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("EditPanel selection-bound inspector sections", () => {
  const source = readFileSync("app/components/design/EditPanel.tsx", "utf8");

  it("remounts all element-bound scrub sections when the selected element changes", () => {
    expect(source).toContain("elementIdentityKey");
    expect(source).toContain("key={`appearance:${elementIdentityKey(");
    expect(source).toContain("key={`fill:${elementIdentityKey(");
    expect(source).toContain("key={`stroke:${elementIdentityKey(");
    expect(source).toContain("key={`effects:${elementIdentityKey(");
    expect(source).toContain("key={`position:${elementIdentityKey(");
    expect(source).toContain("key={`layout-context:${elementIdentityKey(");
  });
});

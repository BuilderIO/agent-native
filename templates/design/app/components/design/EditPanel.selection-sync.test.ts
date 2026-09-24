import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("EditPanel selection-bound inspector sections", () => {
  const source = readFileSync("app/components/design/EditPanel.tsx", "utf8");

  it("remounts all element-bound scrub sections when the selected element changes", () => {
    expect(source).toContain("elementStableKey");
    expect(source).toContain("key={`appearance:${inspectorElementSectionKey}");
    expect(source).toContain(
      "key={`appearance:${selectedScreenElementSectionKey}",
    );
    expect(source).not.toContain("key={`appearance:${elementIdentityKey(");
  });
});

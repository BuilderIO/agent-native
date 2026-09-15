import { describe, expect, it } from "vitest";

import { uniqueNewestFirst } from "./compact-changelogs";

describe("uniqueNewestFirst", () => {
  it("keeps Unreleased ahead of the 100-release package window", () => {
    const numbered = Array.from(
      { length: 100 },
      (_, index) => `## 0.0.${index + 1}\n\n- Release ${index + 1}`,
    );
    const sorted = uniqueNewestFirst([
      numbered[0],
      ...numbered.slice(1),
      "## Unreleased\n\n- Pending release note",
    ]);

    expect(sorted).toHaveLength(101);
    expect(sorted[0]).toContain("## Unreleased");
    expect(sorted[1]).toContain("## 0.0.100");
    expect(sorted.at(-1)).toContain("## 0.0.1");
  });
});

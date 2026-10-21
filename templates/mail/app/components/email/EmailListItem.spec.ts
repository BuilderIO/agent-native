import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function emailListItemSource(): string {
  return readFileSync(new URL("./EmailListItem.tsx", import.meta.url), "utf8");
}

describe("EmailListItem interaction boundary", () => {
  it("does not let nested action controls trigger row keyboard actions", () => {
    const source = emailListItemSource();

    expect(source).toContain(
      "if (!thread || e.target !== e.currentTarget) return;",
    );
    expect(source).toContain(
      "e.preventDefault();\n        e.stopPropagation();",
    );
  });
});

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Workspaces database lifecycle", () => {
  it("routes every create surface through workspace semantics and shared pending state", () => {
    const source = readFileSync(
      new URL("./DatabaseView.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('data?.database.systemRole === "workspaces"');
    expect(source).toContain("createContentSpace.mutateAsync");
    expect(source).toContain("propertyValues:");
    expect(source).toContain("propertyValueOverrides");
    expect(source).toContain("const isCreatingDatabaseItem =");
    expect(source.match(/isCreating=\{isCreatingDatabaseItem/g)).toHaveLength(
      6,
    );
    expect(
      source.match(
        /isCreating=\{isCreatingDatabaseItem \|\| setProperty\.isPending\}/g,
      ),
    ).toHaveLength(3);
  });
});

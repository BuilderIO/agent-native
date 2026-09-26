import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "DesignSystems.tsx"),
  "utf8",
);

describe("Design Systems empty state", () => {
  it("keeps the create action in the empty state without a duplicate header CTA", () => {
    const header = source.slice(
      source.indexOf("useSetHeaderActions("),
      source.indexOf("  return (", source.indexOf("useSetHeaderActions(")),
    );

    expect(source).toContain(
      "const isEmpty = !isLoading && !isError && designSystems.length === 0;",
    );
    expect(header).toContain("{!isEmpty ? (");
    expect(source).toContain(
      "<EmptyState onCreateClick={handleCreateClick} />",
    );
  });
});

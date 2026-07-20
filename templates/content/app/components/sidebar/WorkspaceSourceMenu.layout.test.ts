import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("WorkspaceSourceMenu", () => {
  it("offers the same blank and local-folder sources to every trigger", () => {
    const source = readFileSync(
      new URL("./WorkspaceSourceMenu.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('t("sidebar.newWorkspace")');
    expect(source).toContain('<Link to="/local-files">');
    expect(source).toContain('t("sidebar.localFolder")');
    expect(source).toContain("createContentSpace.mutateAsync");
    expect(source).toContain("propertyValues,");
    expect(source).toContain("const accepted = await onCreated?.(created)");
    expect(source).toContain("if (accepted === false) return");
  });
});

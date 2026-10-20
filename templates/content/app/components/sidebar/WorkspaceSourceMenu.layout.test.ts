import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("WorkspaceSourceMenu", () => {
  it("offers the same blank and local-folder sources to every trigger", () => {
    const source = readFileSync(
      new URL("./WorkspaceSourceMenu.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('t("sidebar.newWorkspace")');
    expect(source).toContain('to="/local-files"');
    expect(source).toContain(
      "state={{ workspacePropertyValues: propertyValues }}",
    );
    expect(source).toContain('t("sidebar.localFolder")');
    expect(source).toContain("createContentSpace.mutateAsync");
    expect(source).toContain("propertyValues,");
    expect(source).toContain("const accepted = await onCreated?.(created)");
    expect(source).toContain("if (accepted === false) return");
  });

  it("can put workspace choices before one source-creation separator", () => {
    const source = readFileSync(
      new URL("./WorkspaceSourceMenu.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("menuStart?: ReactNode");
    expect(source).toContain("{menuStart}");
    expect(source).toContain("{menuStart ? <DropdownMenuSeparator /> : null}");
    expect(source.indexOf("{menuStart}")).toBeLessThan(
      source.indexOf('t("sidebar.newWorkspace")'),
    );
    expect(source.indexOf('t("sidebar.newWorkspace")')).toBeLessThan(
      source.indexOf('to="/local-files"'),
    );
    expect(source).toContain(
      "window.requestAnimationFrame(() => setDialogOpen(true))",
    );
    expect(source).toContain("onCloseAutoFocus={(event) => {");
    expect(source).toContain("if (!openingDialogRef.current) return");
    expect(source).toContain("event.preventDefault()");
  });
});

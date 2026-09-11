import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Workspaces database lifecycle", () => {
  it("routes every create surface through the shared workspace source chooser", () => {
    const source = readFileSync(
      new URL("./DatabaseView.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'const isWorkspaceCatalog = data?.database.systemRole === "workspaces"',
    );
    expect(source).toContain(
      'import { WorkspaceSourceMenu } from "@/components/sidebar/WorkspaceSourceMenu"',
    );
    expect(source.match(/<WorkspaceSourceMenu(?:\s|>)/g)).toHaveLength(2);
    expect(source.match(/<WorkspaceSourceMenuRow/g)).toHaveLength(2);
    expect(source).not.toContain("createContentSpace.mutateAsync");
    expect(source).not.toContain(
      "navigate(`/page/${created.filesDocumentId}`)",
    );
    expect(source).toContain('t("sidebar.addWorkspace")');
    expect(source).toContain("label={newRowLabel}");
    expect(source).toContain(
      "propertyValues={workspaceCreationPropertyValues}",
    );
    expect(source).toContain("canCreateItems={!isWorkspaceCatalog}");
    expect(source).toContain('fallback={workspaceCatalog ? "folder" : "page"}');
    expect(source).toContain('workspaceSpace?.kind === "user"');
    expect(source).toContain("deleteContentSpace.mutateAsync");
    expect(source).toContain('"Delete workspace?"');
    expect(source).toContain("every page and database inside it");
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

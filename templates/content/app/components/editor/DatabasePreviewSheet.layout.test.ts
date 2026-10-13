import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readEditorSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("database preview sheet layout", () => {
  it.each([["database/DatabaseView.tsx"]])(
    "%s lets outside clicks close while preserving preview portals",
    (path) => {
      const source = readEditorSource(path);
      const previewSheet = source.slice(
        source.indexOf("function DatabaseItemPreviewSheet"),
        source.indexOf("function DatabaseTableView"),
      );

      expect(previewSheet).toContain("onInteractOutside={(event) => {");
      expect(previewSheet).toContain(
        "isDatabasePreviewPortalInteraction(event.target)",
      );
      expect(previewSheet).not.toContain(
        "onInteractOutside={(event) => event.preventDefault()}",
      );
      expect(source).toContain(
        "[data-database-preview-portal], [data-radix-popper-content-wrapper]",
      );
      expect(source).toContain('data-database-preview-portal=""');
      expect(source).toContain(
        "<DropdownMenu\n                modal={false}\n                open={actionsMenuOpen}",
      );
    },
  );
});

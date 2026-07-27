import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const databaseViewSource = readFileSync(
  new URL(
    "../../app/components/editor/database/DatabaseView.tsx",
    import.meta.url,
  ),
  "utf8",
);
const documentDatabaseSource = readFileSync(
  new URL("../../app/components/editor/DocumentDatabase.tsx", import.meta.url),
  "utf8",
);
const duplicateBatchActionSource = readFileSync(
  new URL("../../actions/duplicate-database-items.ts", import.meta.url),
  "utf8",
);
const deleteBatchActionSource = readFileSync(
  new URL("../../actions/delete-database-items.ts", import.meta.url),
  "utf8",
);
const singularDuplicateActionSource = readFileSync(
  new URL("../../actions/duplicate-database-item.ts", import.meta.url),
  "utf8",
);
const batchSchemaSource = readFileSync(
  new URL("../../actions/_database-row-batch.ts", import.meta.url),
  "utf8",
);

const databaseImplementationSurfaces = [
  ["DatabaseView.tsx", databaseViewSource],
] as const;

describe("database row batch reliability", () => {
  it("keeps selected duplicate/delete on batch row actions instead of per-row mutations", () => {
    expect(documentDatabaseSource).toContain(
      'import { DatabaseView } from "./database/DatabaseView";',
    );
    expect(documentDatabaseSource).toContain(
      'export * from "./database/DatabaseView";',
    );

    for (const [filename, source] of databaseImplementationSurfaces) {
      expect(source, filename).toContain("useDuplicateDatabaseItems");
      expect(source, filename).toContain("useDeleteDatabaseItems");
      expect(source, filename).not.toContain(
        "for (const item of selectedSnapshot) {\n        await deleteDocument.mutateAsync",
      );
      expect(source, filename).not.toContain(
        "for (const item of selectedSnapshot) {\n        try {\n          const response = await duplicateItem.mutateAsync",
      );
    }
  });

  it("keeps agent-facing descriptions biased toward batch tools for multi-row work", () => {
    expect(duplicateBatchActionSource).toContain(
      "Use this for two or more selected/named rows instead of looping duplicate-database-item",
    );
    expect(deleteBatchActionSource).toContain(
      "Use this for two or more selected/named rows instead of looping delete-document",
    );
    expect(singularDuplicateActionSource).toContain(
      "For two or more rows, use duplicate-database-items once instead of looping this action",
    );
    expect(batchSchemaSource).toContain("Native JSON array");
  });
});

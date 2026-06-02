import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  databaseMembershipDatabaseTitle,
  documentEditorDefaultIconKind,
  documentEditorDatabaseRegionClassName,
  documentEditorTitleRegionClassName,
} from "./DocumentEditor";

describe("document editor layout", () => {
  it("keeps prose titles on the reading column", () => {
    expect(documentEditorTitleRegionClassName(false)).toContain("max-w-3xl");
    expect(documentEditorTitleRegionClassName(false)).toContain("pb-8");
  });

  it("gives database pages a wider database surface", () => {
    expect(documentEditorTitleRegionClassName(true)).toContain("max-w-none");
    expect(documentEditorTitleRegionClassName(true)).toContain("pt-14");
    expect(documentEditorTitleRegionClassName(true)).toContain("sm:pt-7");
    expect(documentEditorTitleRegionClassName(true)).toContain("pb-2");
    expect(documentEditorDatabaseRegionClassName()).toContain("max-w-none");
    expect(documentEditorDatabaseRegionClassName()).toContain("min-w-0");
  });

  it("keeps the editor flex chain shrinkable inside the app shell", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain(
      'className="relative flex min-h-0 min-w-0 flex-1"',
    );
    expect(source).toContain(
      'className="flex min-h-0 min-w-0 flex-1 flex-col"',
    );
  });

  it("defaults database pages to the database icon in the editor", () => {
    expect(
      documentEditorDefaultIconKind({
        database: {
          id: "database",
          documentId: "database-page",
          title: "Content calendar",
          viewConfig: {
            activeViewId: "default",
            views: [],
            sorts: [],
            filters: [],
            columnWidths: {},
          },
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      }),
    ).toBe("database");
    expect(documentEditorDefaultIconKind({ database: undefined })).toBeNull();
  });

  it("labels database row pages with their parent database", () => {
    expect(
      databaseMembershipDatabaseTitle({
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "Content calendar",
        position: 0,
      }),
    ).toBe("Content calendar");
    expect(
      databaseMembershipDatabaseTitle({
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "   ",
        position: 0,
      }),
    ).toBe("Untitled database");
  });
});

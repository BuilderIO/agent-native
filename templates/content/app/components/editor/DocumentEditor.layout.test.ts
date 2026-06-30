import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  databaseMembershipDatabaseTitle,
  documentEditorBreadcrumbItems,
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

  it("keeps desktop comments inside the document scroll surface", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    const scrollIndex = source.indexOf("data-document-print-scroll");
    const contentIndex = source.indexOf("data-document-scroll-content");
    const desktopCommentsIndex = source.indexOf(
      "{showDesktopComments ? sidebar : null}",
    );
    const mobileSheetIndex = source.indexOf("<Sheet");

    expect(scrollIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(scrollIndex);
    expect(desktopCommentsIndex).toBeGreaterThan(contentIndex);
    expect(desktopCommentsIndex).toBeLessThan(mobileSheetIndex);
    expect(source).not.toContain("hasComments && sidebar");
  });

  it("keeps the document toolbar in normal layout flow", () => {
    const source = readFileSync(
      new URL("./DocumentToolbar.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain(
      "relative z-10 flex h-12 shrink-0 items-center gap-3 bg-background px-4",
    );
    expect(source).toContain("ToolbarBreadcrumb");
    expect(source).toContain("formatEditedLabel");
    expect(source).toContain("editor.toolbar.copyPageLink");
    expect(source).not.toContain("absolute top-2 right-2");
    expect(source).not.toContain("shadow-sm");
  });

  it("flushes pending document saves when leaving an editor", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain("const saveDocumentImmediately");
    expect(source).toContain("type PendingDocumentSave");
    expect(source).toContain("pendingDocumentSaveRef.current = pending");
    expect(source).toContain("clearTimeout(saveTimeoutRef.current)");
    expect(source).toContain("const flushPendingDocumentSave = useCallback");
    expect(source).toContain("canEditWhenQueued: canEditRef.current");
    expect(source).toContain("flushPendingDocumentSave(pending)");
    expect(source).toContain("allowQueuedSave: true");
    expect(source).toContain("handleBackgroundSaveError");
    expect(source).toContain("const canEditRef = useRef(canEdit)");
    expect(source).toContain(
      "if (!options.allowQueuedSave && !canEditRef.current) return document",
    );
    expect(source).toContain("if (!canEditRef.current) return");
  });

  it("keeps read-only documents off editor-only realtime endpoints", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain(
      'docId: canEdit && !isLocalFileDocument ? documentId : ""',
    );
    expect(source).toContain(
      "canEdit && !isLocalFileDocument ? documentId : null",
    );
  });

  it("keeps title and content save watermarks independent after partial saves", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain(
      "saved?.title === lastSavedTitleRef.current.title",
    );
    expect(source).toContain(
      "saved?.content === lastSavedContentRef.current.content",
    );
  });

  it("lets slash-created page references use the editor save pipeline", () => {
    const documentEditorSource = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );
    const visualEditorSource = readFileSync(
      new URL("./VisualEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );
    const slashMenuSource = readFileSync(
      new URL("./SlashCommandMenu.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(documentEditorSource).toContain("const handleContentSaveNow");
    expect(documentEditorSource).toContain("contentPersisted");
    expect(visualEditorSource).toContain("onDraftPersisted");
    expect(slashMenuSource).toContain(
      "const persisted = await onDraftPersisted(content)",
    );
    expect(slashMenuSource).toContain("if (!persisted) throw new Error");
    expect(slashMenuSource).not.toContain("useUpdateDocument");
    expect(slashMenuSource).not.toContain("updateDocument.mutateAsync");
  });

  it("copies the open page route for local-file documents", () => {
    const source = readFileSync(
      new URL("./DocumentToolbar.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain("const pageUrl");
    expect(source).toContain(
      "const copyPageUrl = isLocalFileDocument ? pageUrl : shareUrl",
    );
    expect(source).toContain("navigator.clipboard.writeText(copyPageUrl)");
  });

  it("builds a Notion-style breadcrumb from parent documents", () => {
    expect(
      documentEditorBreadcrumbItems(
        {
          id: "child",
          parentId: "parent",
          title: "Draft",
          icon: null,
        },
        [
          {
            id: "root",
            parentId: null,
            title: "Workspace",
            icon: "W",
          },
          {
            id: "parent",
            parentId: "root",
            title: "Project",
            icon: null,
          },
        ],
      ).map((item) => item.title),
    ).toEqual(["Workspace", "Project", "Draft"]);
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

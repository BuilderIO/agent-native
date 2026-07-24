import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  databaseMembershipDatabaseTitle,
  documentEditorBreadcrumbItems,
  documentEditorBreadcrumbNavigationItems,
  documentEditorDefaultIconKind,
  documentEditorDatabaseRegionClassName,
  documentEditorTitleRegionClassName,
  metadataUpdatesWithPendingTitle,
  titleMatchConfirmsSave,
} from "./DocumentEditor";
import { compactToolbarBreadcrumbItems } from "./DocumentToolbar";

describe("document editor layout", () => {
  it("flushes a pending title with an icon update", () => {
    expect(
      metadataUpdatesWithPendingTitle(
        { icon: "🌱" },
        "Renamed page",
        "Untitled",
      ),
    ).toEqual({ icon: "🌱", title: "Renamed page" });
    expect(
      metadataUpdatesWithPendingTitle(
        { icon: "🌱" },
        "Renamed page",
        "Renamed page",
      ),
    ).toEqual({ icon: "🌱" });
  });

  it("stages title edits synchronously for adjacent metadata actions", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      { encoding: "utf8" },
    );
    const handlerStart = source.indexOf(
      "const handleTitleChange = useCallback",
    );
    const refUpdate = source.indexOf(
      "localTitleRef.current = newTitle",
      handlerStart,
    );
    const stateUpdate = source.indexOf("setLocalTitle(newTitle)", handlerStart);

    expect(refUpdate).toBeGreaterThan(handlerStart);
    expect(refUpdate).toBeLessThan(stateUpdate);
  });

  it("does not mistake an optimistic title cache patch for a confirmed save", () => {
    expect(
      titleMatchConfirmsSave({
        serverTitle: "Renamed page",
        localTitle: "Renamed page",
        lastSavedTitle: "Untitled",
        pendingTitle: "Renamed page",
      }),
    ).toBe(false);
    expect(
      titleMatchConfirmsSave({
        serverTitle: "Renamed page",
        localTitle: "Renamed page",
        lastSavedTitle: "Untitled",
        pendingTitle: null,
      }),
    ).toBe(true);
  });

  it("keeps prose titles on the reading column", () => {
    expect(documentEditorTitleRegionClassName(false)).toContain("max-w-3xl");
    expect(documentEditorTitleRegionClassName(false)).toContain("pb-8");
  });

  it("offers page or database after an optimistic blank page opens", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      { encoding: "utf8" },
    );

    expect(source).toContain("const showNewDocumentTypeChooser =");
    expect(source).toContain("!document.database?.systemRole");
    expect(source).toContain("isEffectivelyEmptyDocumentContent(localContent)");
    expect(source).toContain("const handleChoosePage = useCallback");
    expect(source).toContain(
      "await createDatabase.mutateAsync({ documentId })",
    );
    expect(source).toContain("isDatabaseChoicePending(");
    expect(source).toContain("document,\n    createDatabase.isPending");
    expect(source).toContain(
      "disabled={!editorCanEdit || databaseChoicePending}",
    );
    expect(source).toContain('{t("sidebar.page")}');
    expect(source).toContain('{t("sidebar.database")}');
    expect(source.indexOf("if (showNewDocumentTypeChooser)")).toBeLessThan(
      source.indexOf("const primaryEditor ="),
    );
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

  it("shows the editor skeleton instead of stale data during document switches", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain("const { data: queriedDocument, isError }");
    expect(source).toContain("queriedDocument?.id === documentId");
    expect(source).toContain("return <DocumentEditorSkeleton />");
  });

  it("keeps one selected utility rail inside the document scroll surface", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    const scrollIndex = source.indexOf("data-document-print-scroll");
    const contentIndex = source.indexOf("data-document-scroll-content");
    const desktopPanelIndex = source.indexOf("{showDesktopUtilityPanel ? (");
    const mobileSheetIndex = source.indexOf("<Sheet");

    expect(scrollIndex).toBeGreaterThan(-1);
    expect(contentIndex).toBeGreaterThan(scrollIndex);
    expect(desktopPanelIndex).toBeGreaterThan(contentIndex);
    expect(desktopPanelIndex).toBeLessThan(mobileSheetIndex);
    expect(source).toContain(
      'type DocumentUtilityPanel = "info" | "comments" | null',
    );
    expect(source).toContain('utilityPanel === "info"');
    expect(source).toContain('setUtilityPanel("comments")');
    expect(source).not.toContain("showDesktopComments");
  });

  it("moves page metadata to Info and omits the body below full-page databases", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      { encoding: "utf8" },
    );
    const infoPanel = readFileSync(
      new URL("./DocumentInfoPanel.tsx", import.meta.url),
      { encoding: "utf8" },
    );

    expect(source).toContain("<DocumentInfoPanel");
    expect(source).toContain("{!isDatabasePage ? (");
    expect(source.indexOf("{!isDatabasePage ? (")).toBeLessThan(
      source.indexOf("const primaryEditor ="),
    );
    expect(infoPanel).toContain("<DescriptionField");
    expect(infoPanel).toContain("<DocumentProperties");
    expect(infoPanel).toMatch(
      /databaseDocumentId=\{\s*document\.databaseMembership\.databaseDocumentId\s*\}/,
    );
    expect(source).toMatch(
      /<DocumentBlockFields[\s\S]*?databaseDocumentId=\{\s*document\.databaseMembership\.databaseDocumentId\s*\}/,
    );
    expect(source).not.toContain("<DescriptionField");
    expect(source).not.toContain("<DocumentProperties");
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
    expect(source).toContain("editor.toolbar.info");
    expect(source).toContain("comments.title");
    expect(source).toContain("onSelect={() => void handleCopyPageLink()}");
    expect(source).toContain('utilityPanel === "info" ? null : "info"');
    expect(source).toContain('utilityPanel === "comments" ? null : "comments"');
    expect(source).not.toContain('aria-pressed={utilityPanel === "info"}');
    expect(source).not.toContain('aria-pressed={utilityPanel === "comments"}');
    expect(source).toContain("setDeleteDialogOpen(true)");
    expect(source).toContain("text-destructive focus:text-destructive");
    expect(source).toContain("<IconTrash");
    expect(source).toContain("sidebar.deletePageQuestion");
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

  it("renders viewers from SQL while retaining scoped presence", () => {
    const documentEditorSource = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    // Every SQL-backed reader keeps the scoped collaboration subscription for
    // presence, but only editors bind the rendered body to Yjs.
    expect(documentEditorSource).toContain(
      "const collabEnabled = !isLocalFileDocument;",
    );
    expect(documentEditorSource).toContain(
      'docId: collabEnabled ? documentId : "",',
    );
    expect(documentEditorSource).toContain(
      "collabEnabled && canEdit && !bodyHydrationPending;",
    );
    expect(documentEditorSource).toContain(
      "ydoc={collabEditorEnabled ? ydoc : null}",
    );
    expect(documentEditorSource).toContain(
      "awareness={collabEditorEnabled ? awareness : null}",
    );
    expect(documentEditorSource).toContain(
      'collabEditorEnabled && ydoc ? "live-ready"',
    );
    expect(documentEditorSource).toContain(
      'canEdit && !isLocalFileDocument ? "live-pending"',
    );
    expect(documentEditorSource).toContain("snapshot:${document.updatedAt}");
    expect(documentEditorSource).toContain(
      'awareness.setLocalStateField("canFlushDocument", editorCanEdit)',
    );
    expect(documentEditorSource).toContain(
      'awareness.setLocalStateField("canFlushDocument", false)',
    );

    // Comments stay editor-only — viewers must not open the comment endpoints.
    expect(documentEditorSource).toContain(
      "canEdit && !isLocalFileDocument ? documentId : null",
    );

    expect(documentEditorSource).toContain(
      "canEdit &&\n                    collabLoading",
    );
  });

  it("opens comments and selects a highlighted thread atomically", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );
    const activationStart = source.indexOf("const activateCommentThread");
    const activationEnd = source.indexOf(
      "const handleUtilityPanelChange",
      activationStart,
    );
    const activation = source.slice(activationStart, activationEnd);

    expect(activationStart).toBeGreaterThan(-1);
    expect(activation).toContain("setSelectedThreadId(threadId)");
    expect(activation).toContain('setUtilityPanel("comments")');
    expect(source).toContain("onActivateThread={activateCommentThread}");
    expect(source).not.toContain("? setSelectedThreadId\n");
  });

  it("does not clear comment focus at the start of a touch or scroll gesture", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("onPointerDownCapture={(event) => {");
    expect(source).toContain("onClickCapture={(event) => {");
  });

  it("keeps the narrow utility sheet width-safe and vertically reachable", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'className="flex min-h-0 w-[85vw] max-w-sm flex-col overflow-hidden p-0"',
    );
    expect(source).toContain(
      'className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"',
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

  it("localizes the live-editor flush failure fallback", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain('t("editor.liveDocumentSaveBeforeSyncFailed")');
    expect(source).not.toContain(
      'error instanceof Error\n                      ? error.message\n                      : "The live document could not be saved before syncing."',
    );
  });

  it("wakes live-editor flush reads from shared sync events instead of polling", () => {
    const source = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      {
        encoding: "utf8",
      },
    );

    expect(source).toContain("useDbSync({ onEvent: handleFlushRequestEvent })");
    expect(source).toContain('event.source === "app-state"');
    expect(source).toContain(
      'event.key === flushRequestKey || event.key === "*"',
    );
    expect(source).toContain("void flushIfRequested()");
    expect(source).toContain(
      "const persistDocumentUpdatesRef = useRef(persistDocumentUpdates)",
    );
    expect(source).toContain("persistDocumentUpdatesRef.current(updates)");
    expect(source).not.toMatch(
      /useEffect\(\(\) => \{[\s\S]*?void flushIfRequested\(\)[\s\S]*?\}, \[[\s\S]*?persistDocumentUpdates,[\s\S]*?\]\);/,
    );
    expect(source).not.toContain("setTimeout(poll, 600)");
    expect(source).not.toContain("setTimeout(flushIfRequested");
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

  it("starts page breadcrumbs with the containing database", () => {
    expect(
      documentEditorBreadcrumbItems(
        {
          id: "draft",
          parentId: "project",
          title: "Draft",
          icon: null,
          databaseMembership: {
            databaseId: "database",
            databaseDocumentId: "database-page",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        [
          {
            id: "project",
            parentId: null,
            title: "Project",
            icon: null,
          },
        ],
      ).map((item) => item.title),
    ).toEqual(["Personal", "Project", "Draft"]);
  });

  it("does not repeat a containing database already in the page ancestry", () => {
    expect(
      documentEditorBreadcrumbItems(
        {
          id: "draft",
          parentId: "database-page",
          title: "Draft",
          icon: null,
          databaseMembership: {
            databaseId: "database",
            databaseDocumentId: "database-page",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        [
          {
            id: "database-page",
            parentId: null,
            title: "Personal",
            icon: null,
          },
        ],
      ).map((item) => item.title),
    ).toEqual(["Personal", "Draft"]);
  });

  it("keeps the workspace and last two levels visible in deep breadcrumbs", () => {
    expect(
      compactToolbarBreadcrumbItems([
        { id: "files", title: "Personal" },
        { id: "one", title: "Page 1" },
        { id: "two", title: "Page 2" },
        { id: "draft", title: "Draft" },
      ]).map((item) => item.title),
    ).toEqual(["Personal", "…", "Page 2", "Draft"]);
  });

  it("offers workspace and same-level page choices from breadcrumbs", () => {
    const items = documentEditorBreadcrumbNavigationItems(
      [
        { id: "personal-files", title: "Personal" },
        { id: "draft", title: "Draft" },
      ],
      [
        {
          id: "draft",
          parentId: null,
          title: "Draft",
          icon: null,
          position: 0,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 0,
          },
        },
        {
          id: "notes",
          parentId: null,
          title: "Notes",
          icon: null,
          position: 1,
          databaseMembership: {
            databaseId: "personal",
            databaseDocumentId: "personal-files",
            databaseTitle: "Personal",
            position: 1,
          },
        },
      ],
      [
        { filesDocumentId: "personal-files", name: "Personal" },
        { filesDocumentId: "team-files", name: "Team" },
      ],
    );

    expect(items[0].menuItems?.map((item) => item.title)).toEqual([
      "Personal",
      "Team",
    ]);
    expect(items[0].iconKind).toBe("folder");
    expect(items[0].menuItems?.map((item) => item.iconKind)).toEqual([
      "folder",
      "folder",
    ]);
    expect(items[1].menuItems?.map((item) => item.title)).toEqual([
      "Draft",
      "Notes",
    ]);
  });

  it("links a top-level Files database back to Workspaces", () => {
    const items = documentEditorBreadcrumbNavigationItems(
      [{ id: "personal-files", title: "Personal" }],
      [],
      [{ filesDocumentId: "personal-files", name: "Personal" }],
      {
        currentDocumentId: "personal-files",
        currentParentId: null,
        currentDatabaseSystemRole: "files",
        catalogDocumentId: "workspaces-document",
        workspacesTitle: "Workspaces",
      },
    );

    expect(items.map((item) => item.title)).toEqual(["Workspaces", "Personal"]);
    expect(items.map((item) => item.id)).toEqual([
      "workspaces-document",
      "personal-files",
    ]);
    expect(items.map((item) => item.iconKind)).toEqual(["folder", "folder"]);
  });

  it("keeps hover-open breadcrumb menus non-modal and uses folder icons", () => {
    const source = readFileSync(
      new URL("./DocumentToolbar.tsx", import.meta.url),
      { encoding: "utf8" },
    );

    expect(source).toContain("<DropdownMenu modal={false}");
    expect(source).toContain('item.iconKind === "folder"');
    expect(source).toContain('menuItem.iconKind === "folder"');
  });
});

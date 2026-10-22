import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashSlideSource } from "../server/lib/slide-source.js";
import { hashSlideContent } from "../shared/slide-fit";

let mockRows: unknown[] = [];
let mockCommentRows: unknown[] = [];
let navigationState: Record<string, unknown> | null = null;
let slidesSelectionState: Record<string, unknown> | null = null;
let slidesOpenPanelState: Record<string, unknown> | null = null;
let slideEditorStatusState: Record<string, unknown> | null = null;
let slideEditorCommandState: Record<string, unknown> | null = null;
let deckHistoryStatusState: Record<string, unknown> | null = null;
let deckHistoryCommandState: Record<string, unknown> | null = null;
let slideFitState: Record<string, unknown> | null = null;
let deckFitState: Record<string, unknown> | null = null;
let appStateReadCalls: Array<{
  key: string;
  options?: { fallbackToGlobal?: boolean };
}> = [];

function whereConditions(condition: unknown): unknown[] {
  if (
    typeof condition === "object" &&
    condition !== null &&
    "and" in condition &&
    Array.isArray(condition.and)
  ) {
    return condition.and;
  }
  return [condition];
}

function hasSlides2DeckScope(condition: unknown): boolean {
  if (typeof condition !== "object" || condition === null) return false;
  if (
    "strings" in condition &&
    Array.isArray(condition.strings) &&
    typeof condition.strings.join === "function"
  ) {
    const text = condition.strings.join("");
    return text.includes("->> 'appId'") && text.includes("'slides-2'");
  }
  return false;
}

function rowsForCondition(condition: unknown) {
  return whereConditions(condition).some(hasSlides2DeckScope)
    ? mockRows.filter(
        (row) =>
          typeof row !== "object" ||
          row === null ||
          !("appId" in row) ||
          row.appId === "slides-2",
      )
    : mockRows;
}

const limitFn = vi.fn(async () => mockRows);
const orderByFn = vi.fn(async () => mockRows);
const whereFn = vi.fn((condition: unknown) => ({
  limit: async () => {
    await limitFn();
    return rowsForCondition(condition);
  },
  orderBy: async () => {
    await orderByFn();
    return rowsForCondition(condition);
  },
}));
const fromFn = vi.fn((table: unknown) => ({
  where: (condition: unknown) =>
    typeof table === "object" &&
    table !== null &&
    Object.values(table).includes("comment_id_col")
      ? {
          orderBy: () => ({
            limit: async () => mockCommentRows,
          }),
        }
      : whereFn(condition),
}));
const selectFn = vi.fn((..._args: unknown[]) => ({ from: fromFn }));
const mockDb = { select: selectFn };

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    decks: {
      id: "id_col",
      title: "title_col",
      ownerEmail: "owner_email_col",
      updatedAt: "updated_at_col",
      data: "data_col",
    },
    slideComments: {
      id: "comment_id_col",
      slideId: "comment_slide_id_col",
      deckId: "comment_deck_id_col",
      threadId: "comment_thread_id_col",
      parentId: "comment_parent_id_col",
      content: "comment_content_col",
      quotedText: "comment_quoted_text_col",
      anchor: "comment_anchor_col",
      emojiReactionsJson: "comment_reactions_col",
      authorEmail: "comment_author_email_col",
      resolved: "comment_resolved_col",
      createdAt: "comment_created_at_col",
    },
    deckShares: {},
  },
}));

vi.mock("./_tab-state.js", () => ({
  readAppStateForCurrentTab: vi.fn(
    async (key: string, options?: { fallbackToGlobal?: boolean }) => {
      appStateReadCalls.push({ key, options });
      if (key === "navigation") {
        return navigationState ? { app: "slides-2", ...navigationState } : null;
      }
      if (key === "slides-2:slides-panels") return null;
      if (key === "slides-2:slides-selection") return slidesSelectionState;
      if (key === "slides-2:slides-open-panel") return slidesOpenPanelState;
      if (key === "slides-2:slide-editor-status") return slideEditorStatusState;
      if (key === "slides-2:slide-editor-command")
        return slideEditorCommandState;
      if (key === "slides-2:deck-history-status") return deckHistoryStatusState;
      if (key === "slides-2:deck-history-command")
        return deckHistoryCommandState;
      if (key === "slides-2:slide-fit-check") return slideFitState;
      if (key === "slides-2:deck-fit-checks") return deckFitState;
      return null;
    },
  ),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => undefined,
  getRequestUserEmail: () => "alice@example.com",
}));

vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: () => ({ allowed: true }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  asc: (value: unknown) => ({ asc: value }),
  desc: (value: unknown) => ({ desc: value }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  sql: vi.fn((strings: unknown, ...values: unknown[]) => ({ strings, values })),
}));

vi.mock("./get-design-system.js", () => ({
  default: {
    run: vi.fn(async ({ id }: { id: string }) => ({
      id,
      title: "Acme",
      agentContext: "Use --brand-accent: #123456.",
    })),
  },
}));

import action from "./view-screen";

describe("template library screen context", () => {
  it.each(["templates", "list"])(
    "reports selected templates from %s without reading deck bodies",
    async (view) => {
      navigationState = { view, templateId: "starter-update" };
      const result = await action.run({});
      expect(result).toContain(`view: ${view}`);
      expect(result).toContain("templateId: starter-update");
      expect(result).toContain("create-deck-from-template");
      expect(selectFn).not.toHaveBeenCalled();
      expect(result).not.toContain("<div");
    },
  );
  it("reports template search results rather than the deck list", async () => {
    navigationState = { view: "templates", search: "no-template-matches" };
    const result = await action.run({});
    expect(result).toContain("templateSearch: no-template-matches");
    expect(result).not.toContain("### All decks");
    expect(selectFn).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRows = [];
  mockCommentRows = [];
  navigationState = null;
  slidesSelectionState = null;
  slidesOpenPanelState = null;
  slideEditorStatusState = null;
  slideEditorCommandState = null;
  deckHistoryStatusState = null;
  deckHistoryCommandState = null;
  slideFitState = null;
  deckFitState = null;
  appStateReadCalls = [];
});

describe("view-screen", () => {
  it("falls back to canonical navigation while keeping editor state tab-scoped", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<h1>Opening</h1>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1" };

    await action.run({});

    expect(appStateReadCalls).toContainEqual({
      key: "navigation",
      options: { fallbackToGlobal: true },
    });
    expect(appStateReadCalls).toContainEqual({
      key: "slides-2:slides-selection",
      options: { fallbackToGlobal: false },
    });
    expect(appStateReadCalls).toContainEqual({
      key: "slides-2:slides-open-panel",
      options: { fallbackToGlobal: false },
    });
    expect(appStateReadCalls).toContainEqual({
      key: "slides-2:slide-editor-status",
      options: { fallbackToGlobal: false },
    });
  });

  it("surfaces only the active DeckEditor history identity and command result", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        ownerEmail: "alice@example.com",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<h1>Opening</h1>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1" };
    deckHistoryStatusState = {
      protocolVersion: 1,
      deckId: "deck-1",
      editorSessionId: "deck_editor_session_1",
      historyVersion: 8,
      canUndo: true,
      canRedo: false,
    };
    deckHistoryCommandState = {
      protocolVersion: 1,
      commandId: "command_123456",
      operation: "undo",
      deckId: "deck-1",
      editorSessionId: "deck_editor_session_1",
      historyVersion: 7,
      status: "applied",
      completedAt: 123,
    };

    const result = await action.run({});

    expect(result).toContain("### DeckEditor history");
    expect(result).toContain("editorSessionId: deck_editor_session_1");
    expect(result).toContain("historyVersion: 8");
    expect(result).toContain("historyControls: canUndo=true canRedo=false");
    expect(result).toContain(
      "lastDeckHistoryCommand: id=command_123456 operation=undo status=applied",
    );
    expect(appStateReadCalls).toContainEqual({
      key: "slides-2:deck-history-status",
      options: { fallbackToGlobal: false },
    });
  });

  it("ignores navigation state owned by another app", async () => {
    navigationState = { app: "slides", view: "editor", deckId: "other-deck" };

    const result = await action.run({});

    expect(result).not.toContain("view: editor");
    expect(result).not.toContain("other-deck");
  });
  it("projects only metadata columns for the deck list — never selects the deck body", async () => {
    mockRows = [
      {
        id: "deck_123",
        title: "Roadmap",
        ownerEmail: "alice@example.com",
      },
    ];
    navigationState = { view: "list" };

    const result = await action.run({});

    expect(selectFn).toHaveBeenCalledWith({
      id: "id_col",
      title: "title_col",
      ownerEmail: "owner_email_col",
    });
    expect(result).toContain("id=deck_123");
    expect(result).toContain('title="Roadmap"');
    expect(result).not.toContain("slides=");
  });

  it("reports the Home templates tab without querying deck rows", async () => {
    navigationState = { view: "list", homeTab: "templates" };

    const result = await action.run({});

    expect(result).toContain("homeTab: templates");
    expect(result).toContain("### Home templates (");
    expect(result).not.toContain("### All decks");
    expect(selectFn).not.toHaveBeenCalled();
  });

  it("filters recent deck context by search and ownership", async () => {
    mockRows = [
      { id: "deck_1", title: "Roadmap", ownerEmail: "alice@example.com" },
      { id: "deck_2", title: "Roadmap Draft", ownerEmail: "bob@example.com" },
      {
        id: "deck_3",
        title: "Quarterly Review",
        ownerEmail: "alice@example.com",
      },
    ];
    navigationState = {
      view: "list",
      homeTab: "recent",
      deckSearch: "roadmap",
      deckFilter: "created-by-me",
    };

    const result = await action.run({});

    expect(result).toContain("homeTab: recent");
    expect(result).toContain("deckSearch: roadmap");
    expect(result).toContain("id=deck_1");
    expect(result).not.toContain("id=deck_2");
    expect(result).not.toContain("id=deck_3");
  });

  it("still fetches full deck content for a single open deck", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Quarterly Review",
          slides: [
            { id: "slide-a", layout: "title", content: "<h1>Opening</h1>" },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };

    const result = await action.run({});

    expect(limitFn).toHaveBeenCalled();
    expect(orderByFn).not.toHaveBeenCalled();
    expect(result).toContain("deckId: deck-1");
    expect(result).toContain("slideCount: 1");
    expect(result).toContain(
      `currentSlideContentHash: ${hashSlideContent("<h1>Opening</h1>")}`,
    );
    expect(result).toContain("<h1>Opening</h1>");
  });

  it("reports the in-editor preview mode", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<h1>Opening</h1>" }],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideIndex: 0,
      editorMode: "preview",
    };

    const result = await action.run({});

    expect(result).toContain("editorMode: preview");
  });

  it("uses the persisted active slide ID when its index is stale", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            { id: "slide-a", content: "<h1>Opening</h1>" },
            { id: "slide-b", content: "<h1>Decision</h1>" },
          ],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-b",
      slideIndex: 0,
    };

    const result = await action.run({});

    expect(result).toContain("currentSlideNumber: 2 of 2");
    expect(result).toContain("currentSlideId: slide-b");
  });

  it("exposes only current tab-scoped editor draft and command metadata", async () => {
    const sourceTsx =
      "export default function Slide() { return <h1>Draft</h1>; }";
    const sourceHash = hashSlideSource(sourceTsx);
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", sourceTsx, content: "<h1>Draft</h1>" }],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slideEditorStatusState = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-a",
      editorSessionId: "editor_session_1",
      historyVersion: 4,
      sourceRevision: 1,
      sourceHash,
      hasPendingEdits: true,
      canUndo: true,
      canRedo: false,
      canSave: true,
    };
    slideEditorCommandState = {
      protocolVersion: 1,
      commandId: "command_123456",
      operation: "undo",
      deckId: "deck-1",
      slideId: "slide-a",
      editorSessionId: "editor_session_1",
      historyVersion: 4,
      sourceRevision: 1,
      sourceHash,
      status: "applied",
      completedAt: 123,
    };

    const result = await action.run({});

    expect(result).toContain("### Visual editor draft");
    expect(result).toContain("editorSessionId: editor_session_1");
    expect(result).toContain("editorHistoryVersion: 4");
    expect(result).toContain("editorDraft: pending edits; canSave=true");
    expect(result).toContain(
      "editorHistoryControls: canUndo=true canRedo=false",
    );
    expect(result).toContain(
      "lastEditorCommand: id=command_123456 operation=undo status=applied",
    );
    expect(result).not.toContain(sourceTsx);
  });

  it("omits editor draft state whose source identity is stale", async () => {
    const sourceTsx =
      "export default function Slide() { return <h1>Current</h1>; }";
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", sourceTsx, content: "<h1>Current</h1>" }],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slideEditorStatusState = {
      protocolVersion: 1,
      deckId: "deck-1",
      slideId: "slide-a",
      editorSessionId: "old_session_1",
      historyVersion: 1,
      sourceRevision: 1,
      sourceHash: "0".repeat(64),
      hasPendingEdits: true,
      canUndo: true,
      canRedo: false,
      canSave: true,
    };

    const result = await action.run({});

    expect(result).not.toContain("### Visual editor draft");
    expect(result).not.toContain("old_session_1");
  });

  it("surfaces source-located selections with the source editor action path", async () => {
    const sourceTsx =
      "export default function Slide() { return <h1>Opening</h1>; }";
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              sourceTsx,
              content: "<h1>Opening</h1>",
            },
          ],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: hashSlideSource(sourceTsx),
      mode: "single",
      textRange: {
        slideId: "slide-a",
        sourceLine: 1,
        sourceColumn: 48,
        sourceRevision: 1,
        sourceHash: hashSlideSource(sourceTsx),
        start: 0,
        end: 4,
        expectedText: "Opening",
      },
      items: [
        {
          sourceLine: 1,
          sourceColumn: 48,
          instanceIndex: 1,
          instanceCount: 2,
          sourceTag: "h1",
          sourceText: "Opening",
          sourceStyle: { color: "navy" },
        },
      ],
    };

    const result = await action.run({});

    expect(result).toContain("use this for update-slide-source --slideId");
    expect(result).toContain(
      "preview hash only; read get-slide-source for the revision and sourceHash used by update-slide-source",
    );
    expect(result).toContain("selected 1: source element <h1> at 1:48");
    expect(result).toContain("renderedInstance: 2 of 2");
    expect(result).toContain(
      "sourceCallsiteStatus: shared across 2 visible instances; duplicate/delete cannot target one rendered copy safely and will be rejected",
    );
    expect(result).toContain('sourceTextPreview: "Opening"');
    expect(result).toContain("sourceSelectionStatus: current");
    expect(result).toContain(
      "sourceTargetStatus: use get-slide-source, then update-slide-source with line=1, column=48",
    );
    expect(result).toContain(
      'selectedTextRange: source element at 1:48; UTF-16 offsets [0, 4); expectedText="Opening"',
    );
    expect(result).toContain(
      "selectedTextRangeStatus: current; use update-slide-source with set-text-range-style at line=1, column=48, start=0, end=4, and expectedText as prevText",
    );
    expect(result).toContain('sourceStyle: {"color":"navy"}');
  });

  it("does not recommend stale source coordinates after the slide source changes", async () => {
    const selectedSource =
      "export default function Slide() { return <h1>Opening</h1>; }";
    const currentSource =
      "export default function Slide() { return <h1>Updated</h1>; }";
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              sourceTsx: currentSource,
              revision: 2,
              sourceHash: hashSlideSource(currentSource),
              content: "<h1>Updated</h1>",
            },
          ],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: hashSlideSource(selectedSource),
      textRange: {
        slideId: "slide-a",
        sourceLine: 1,
        sourceColumn: 48,
        sourceRevision: 1,
        sourceHash: hashSlideSource(selectedSource),
        start: 0,
        end: 4,
        expectedText: "Opening",
      },
      items: [{ sourceLine: 1, sourceColumn: 48, sourceTag: "h1" }],
    };

    const result = await action.run({});

    expect(result).toContain("sourceSelectionStatus: stale or unverified");
    expect(result).toContain(
      "sourceTargetStatus: the selection source identity is stale or unavailable",
    );
    expect(result).not.toContain(
      "use get-slide-source, then update-slide-source with line=1, column=48",
    );
    expect(result).not.toContain("selectedTextRange:");
    expect(result).not.toContain("selectedTextRangeStatus:");
  });

  it("omits malformed source text ranges", async () => {
    const sourceTsx =
      "export default function Slide() { return <h1>Opening</h1>; }";
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              sourceTsx,
              content: "<h1>Opening</h1>",
            },
          ],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: hashSlideSource(sourceTsx),
      items: [{ sourceLine: 1, sourceColumn: 48, sourceTag: "h1" }],
      textRange: {
        slideId: "slide-a",
        sourceLine: 1,
        sourceColumn: 48,
        sourceRevision: 1,
        sourceHash: hashSlideSource(sourceTsx),
        start: 0,
        end: 99,
        expectedText: "Opening",
      },
    };

    const result = await action.run({});

    expect(result).not.toContain("selectedTextRange:");
    expect(result).not.toContain("selectedTextRangeStatus:");
  });

  it("does not trust a selection when stored source integrity is invalid", async () => {
    const sourceTsx =
      "export default function Slide() { return <h1>Opening</h1>; }";
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              sourceTsx,
              revision: 1,
              sourceHash: "0".repeat(64),
              content: "<h1>Opening</h1>",
            },
          ],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      sourceRevision: 1,
      sourceHash: hashSlideSource(sourceTsx),
      items: [{ sourceLine: 1, sourceColumn: 48, sourceTag: "h1" }],
    };

    const result = await action.run({});

    expect(result).toContain(
      "sourceSelectionStatus: current source integrity could not be verified",
    );
    expect(result).toContain(
      "sourceTargetStatus: the selection source identity is stale or unavailable",
    );
    expect(result).not.toContain(
      "use get-slide-source, then update-slide-source with line=1, column=48",
    );
  });

  it("surfaces an open panel only when both deck and slide match", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<h1>Opening</h1>" }],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slidesOpenPanelState = {
      deckId: "deck-other",
      slideId: "slide-a",
      panel: "layers",
    };

    const staleResult = await action.run({});
    expect(staleResult).not.toContain("openPanel: layers");

    slidesOpenPanelState = {
      deckId: "deck-1",
      slideId: "slide-a",
      panel: "layers",
    };
    const currentResult = await action.run({});
    expect(currentResult).toContain("openPanel: layers");
  });

  it("includes the linked design-system context in the current deck read", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        designSystemId: "ds-1",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Quarterly Review",
          slides: [{ id: "slide-a", content: "<h1>Opening</h1>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };

    const result = await action.run({});

    expect(result).toContain("### Linked design system (authoritative)");
    expect(result).toContain("Use --brand-accent: #123456.");
  });

  it("reports the current deck tweak map and the available preset choices", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        designSystemId: "default",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Quarterly Review",
          designSystemId: "default",
          tweaks: { accentColor: "#609FF8", paperBackground: "warm" },
          slides: [{ id: "slide-a", content: "<h1>Opening</h1>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };

    const result = await action.run({});

    expect(result).toContain(
      'storedTweaks: {"accentColor":"#609FF8","paperBackground":"warm"}',
    );
    expect(result).toContain(
      '- accentColor (Accent color): current="#609FF8"; choices="#00E5FF" (Cyan), "#609FF8" (Blue), "#4ADE80" (Green), "#F472B6" (Pink), "#FBBF24" (Gold)',
    );
    expect(result).toContain(
      '- titleCase (Title case): current="uppercase"; choices="lowercase" (lower), "capitalize" (Title), "uppercase" (UPPER)',
    );
    expect(result).toContain(
      "Change these with patch-deck-fields.fields.tweaks; include the complete storedTweaks map and use exact listed choices.",
    );
  });

  it("surfaces stable freeform object identity alongside the runtime selector", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Quarterly Review",
          slides: [
            {
              id: "slide-a",
              layout: "blank",
              content:
                '<div class="fmd-slide"><div data-slide-object-id="object-1">Text</div></div>',
            },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      mode: "box-selected",
      activeTool: "select",
      items: [
        {
          selector: '[data-slide-object-id="object-1"]',
          runtimeSelector: '[data-builder-id="b-7"]',
          objectId: "object-1",
          kind: "element",
          tagName: "div",
          text: "Text",
          selectedText: "Text",
          textTruncated: false,
        },
        {
          selector: '[data-slide-object-id="object-2"]',
          objectId: "object-2",
          kind: "element",
          tagName: "div",
          text: "Other text",
          textTruncated: false,
        },
      ],
    };

    const result = await action.run({});

    expect(result).toContain("selectionSlideId: slide-a");
    expect(result).toContain("mode: box-selected");
    expect(result).toContain('selector=[data-slide-object-id="object-1"]');
    expect(result).toContain("objectId: object-1");
    expect(result).toContain('runtimeSelector: [data-builder-id="b-7"]');
    expect(result).toContain("selectedText: Text");
    expect(result).toContain(
      "selectedTextStatus: exact browser range on a legacy/imported HTML slide; use verbatim as edits.find with expectedMatches: 1",
    );
    expect(result).toContain(
      "textStatus: element preview; use selectedText for a literal replacement",
    );
    expect(result).toContain(
      "objectIdStatus: stable selected-element target on a legacy/imported HTML slide; use it with one update-slide replace edit when selectedText is unavailable",
    );
    expect(result).toContain(
      "textStatus: element preview is not an exact browser-range selection; use objectId with update-slide for an element-only replacement",
    );
  });

  it("routes source-backed selections without source locators through source actions", async () => {
    const sourceTsx =
      "export default function Slide() { return <h1>Unique title</h1>; }";
    mockRows = [
      {
        id: "deck-1",
        title: "Source deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              sourceTsx,
              content: "<h1>Unique title</h1>",
            },
          ],
        }),
      },
    ];
    navigationState = {
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-a",
      slideIndex: 0,
    };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      mode: "box-selected",
      items: [
        {
          objectId: "selected-title",
          kind: "element",
          tagName: "h1",
          text: "Unique title",
          textTruncated: false,
        },
      ],
    };

    const result = await action.run({});

    expect(result).toContain(
      "objectIdStatus: React source-backed slide; do not use objectId with update-slide",
    );
    expect(result).toContain(
      "textStatus: React source-backed element preview; read get-slide-source and map it to a unique JSX source locator for update-slide-source",
    );
    expect(result).not.toContain(
      "textStatus: element preview is not an exact browser-range selection; use objectId with update-slide for an element-only replacement",
    );
    expect(result).not.toContain("use it with one update-slide replace edit");
  });

  it("names a representative sibling even when the deck tallies no styles", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Class styled",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Class styled",
          slides: [
            {
              id: "slide-a",
              layout: "content",
              content:
                '<div class="fmd-slide bg-black text-white"><h2>A</h2></div>',
            },
            {
              id: "slide-b",
              layout: "content",
              content:
                '<div class="fmd-slide bg-black text-white"><h2>B</h2></div>',
            },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };

    const result = await action.run({});

    expect(result).toContain(
      "representativeSlide: id=slide-b (slide 2, layout=content)",
    );
    expect(result).not.toContain("backgrounds:");
  });

  it("does not surface a selection from a different slide", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          title: "Quarterly Review",
          slides: [{ id: "slide-a", layout: "blank", content: "<p>A</p>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-b",
      mode: "single",
      items: [{ selector: '[data-builder-id="b-8"]' }],
    };

    const result = await action.run({});

    expect(result).not.toContain("### Current visual selection");
  });

  it("does not trust a selection without its owning deck ID", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<p>A</p>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      slideId: "slide-a",
      mode: "single",
      items: [{ selector: '[data-builder-id="b-1"]', selectedText: "A" }],
    };

    const result = await action.run({});

    expect(result).not.toContain("### Current visual selection");
    expect(result).not.toContain("selectedText: A");
  });

  it("surfaces a selection made on a different slide than the stale/cross-tab currentSlide", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            { id: "slide-a", content: "<h1>Opening</h1>" },
            { id: "slide-b", content: "<h1>The 4-Step Journey</h1>" },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-b",
      mode: "editing",
      items: [{ selector: '[data-builder-id="b-2"]', selectedText: "4-Step" }],
    };

    const result = await action.run({});

    expect(result).toContain("### Current visual selection");
    expect(result).toContain("selectionSlideId: slide-b");
    expect(result).toContain("differs from currentSlideId slide-a");
    expect(result).toContain(
      `selectionSlideContentHash: ${hashSlideContent("<h1>The 4-Step Journey</h1>")}`,
    );
    expect(result).toContain("selectedText: 4-Step");
  });

  it("routes image selections away from text replacement", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Image deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              content: '<img data-slide-object-id="image-1" />',
            },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      mode: "box-selected",
      items: [
        {
          selector: '[data-slide-object-id="image-1"]',
          objectId: "image-1",
          kind: "image",
          tagName: "img",
        },
      ],
    };

    const result = await action.run({});

    expect(result).not.toContain("objectId: image-1");
    expect(result).toContain(
      "imageStatus: image selection has no editable text content; use the targeted image/markup workflow",
    );
  });

  it("surfaces a selected video's source and media editing workflow", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Video deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [
            {
              id: "slide-a",
              content:
                '<video data-slide-object-id="video-1" src="https://media.example.com/clip.mp4" controls></video>',
            },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      mode: "box-selected",
      items: [
        {
          selector: '[data-slide-object-id="video-1"]',
          objectId: "video-1",
          kind: "video",
          tagName: "video",
          videoSrc: "https://media.example.com/clip.mp4",
        },
      ],
    };

    const result = await action.run({});

    expect(result).toContain("objectId: video-1");
    expect(result).toContain(
      "videoStatus: legacy/imported HTML video selection has no editable text content; use update-slide to change its source or playback attributes",
    );
    expect(result).toContain("videoSrc: https://media.example.com/clip.mp4");
  });

  it("does not surface a selection left over from a different deck", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<p>A</p>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-other",
      slideId: "slide-a",
      mode: "single",
      items: [{ selector: '[data-builder-id="b-1"]' }],
    };

    const result = await action.run({});

    expect(result).not.toContain("### Current visual selection");
  });

  it("marks long selection text as a preview before editing", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<p>Long text</p>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    slidesSelectionState = {
      deckId: "deck-1",
      slideId: "slide-a",
      items: [
        { text: "x".repeat(100), textTruncated: false },
        { text: "y".repeat(80), textTruncated: true },
      ],
    };

    const result = await action.run({});

    expect(result).toContain(
      "textStatus: element preview may be truncated; use get-deck with slideId=slide-a before editing",
    );
    expect(result).toContain(
      "textStatus: element text is complete but is not an exact browser-range selection; use get-deck with slideId=slide-a before editing",
    );
  });

  it("filters the list to decks created by the current user without reading deck bodies", async () => {
    mockRows = [
      { id: "deck_1", title: "Mine", ownerEmail: "Alice@Example.com" },
      { id: "deck_2", title: "Theirs", ownerEmail: "bob@example.com" },
    ];
    navigationState = { view: "list", deckFilter: "created-by-me" };

    const result = await action.run({});

    expect(result).toContain("id=deck_1");
    expect(result).not.toContain("id=deck_2");
    expect(result).toContain("Decks created by current user (1 of 2)");
  });

  it("filters and labels Shared decks in current screen context", async () => {
    mockRows = [
      { id: "deck_1", title: "Mine", ownerEmail: "Alice@Example.com" },
      { id: "deck_2", title: "Shared", ownerEmail: "bob@example.com" },
    ];
    navigationState = { view: "list", homeTab: "recent", deckFilter: "shared" };

    const result = await action.run({});

    expect(result).toContain("deckFilter: shared with me");
    expect(result).toContain("Decks shared with current user (1 of 2)");
    expect(result).toContain("id=deck_2");
    expect(result).not.toContain("id=deck_1");
  });

  it("excludes other apps while retaining access-filtered deck scope", async () => {
    mockRows = [
      {
        id: "slides2-deck",
        title: "Slides 2 deck",
        ownerEmail: "alice@example.com",
        appId: "slides-2",
      },
      {
        id: "other-app-deck",
        title: "Other app deck",
        ownerEmail: "bob@example.com",
        appId: "other-app",
      },
    ];
    navigationState = { view: "list", deckFilter: "all" };

    const result = await action.run({});
    const conditions = whereConditions(whereFn.mock.calls.at(-1)?.[0]);

    expect(conditions).toContainEqual({ allowed: true });
    expect(conditions.some(hasSlides2DeckScope)).toBe(true);
    expect(result).toContain("id=slides2-deck");
    expect(result).not.toContain("other-app-deck");
    expect(result).toContain("All decks (1 of 1)");
  });

  it.each([
    {
      name: "Shared filter",
      navigation: { view: "list", deckFilter: "shared" },
      expected: "(no decks match the current Home filters)",
    },
    {
      name: "deck search",
      navigation: { view: "list", deckFilter: "all", deckSearch: "pitch" },
      expected: "(no decks match the current Home filters)",
    },
    {
      name: "unfiltered list",
      navigation: { view: "list", deckFilter: "all" },
      expected: "(no decks — use create-deck to make one)",
    },
  ])("reports the empty state for $name", async ({ navigation, expected }) => {
    navigationState = navigation;

    const result = await action.run({});

    expect(result).toContain(expected);
  });

  it("lets the current slide measurement override a stale deck-wide fit claim", async () => {
    const slideAContent = "<p>A</p>";
    const slideBContent = "<p>B</p>";
    const measurement = (content: string, verticalOverflow = 0) => ({
      contentHash: hashSlideContent(content),
      contentHeight: verticalOverflow > 0 ? 645 : 380,
      contentWidth: 740,
      viewportHeight: 420,
      viewportWidth: 740,
      verticalOverflow,
      horizontalOverflow: 0,
      measuredAt: 2000,
    });

    mockRows = [
      {
        id: "deck-1",
        title: "Quarterly Review",
        data: JSON.stringify({
          appId: "slides-2",
          aspectRatio: "16:9",
          slides: [
            { id: "slide-a", content: slideAContent },
            { id: "slide-b", content: slideBContent },
          ],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    deckFitState = {
      deckId: "deck-1",
      aspectRatio: "16:9",
      slides: {
        "slide-a": measurement(slideAContent),
        "slide-b": measurement(slideBContent),
      },
    };
    slideFitState = {
      ...measurement(slideAContent, 225),
      slideId: "slide-a",
      deckId: "deck-1",
    };

    const result = await action.run({});

    expect(result).toContain("### ⚠ Layout overflows the canvas");
    expect(result).toContain(
      "Overflow detected on 1 slide(s): slide 1 (225px vertical, 0px horizontal).",
    );
    expect(result).not.toContain(
      "All 2 slides fit their measured content area.",
    );
  });

  it("marks current-slide comments as truncated when more are available", async () => {
    mockRows = [
      {
        id: "deck-1",
        title: "Comment-heavy deck",
        data: JSON.stringify({
          appId: "slides-2",
          slides: [{ id: "slide-a", content: "<p>Slide</p>" }],
        }),
      },
    ];
    navigationState = { view: "editor", deckId: "deck-1", slideIndex: 0 };
    mockCommentRows = Array.from({ length: 101 }, (_, index) => ({
      id: `comment-${index}`,
      slideId: "slide-a",
      threadId: `thread-${index}`,
      parentId: null,
      content: `Comment ${index}`,
      quotedText: null,
      anchor: null,
      emojiReactionsJson: "{}",
      authorEmail: "alice@example.com",
      resolved: false,
      createdAt: `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));

    const result = await action.run({});

    expect(result).toContain(
      "### Comments on current slide (100; more available)",
    );
    expect(result).toContain(
      'commentsStatus: truncated; showing the first 100. Use list-slide-comments with { deckId: "deck-1", slideId: "slide-a", limit: 100, offset: 100 } to continue.',
    );
    expect(result).toContain("commentId: comment-0");
    expect(result).not.toContain("commentId: comment-100");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  getCurrentRequestBrowserTabId: vi.fn(),
  readAppStateForCurrentTab: vi.fn(),
  compareAndSetAppStateForCurrentTab: vi.fn(),
  deckRow: null as null | { id: string; data: string },
  appState: new Map<string, Record<string, unknown>>(),
  select: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: { decks: { id: "deck_id", data: "deck_data" } },
}));

vi.mock("./_tab-state.js", () => ({
  getCurrentRequestBrowserTabId: mocks.getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab: mocks.readAppStateForCurrentTab,
  compareAndSetAppStateForCurrentTab: mocks.compareAndSetAppStateForCurrentTab,
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import { hashSlideSource } from "../server/lib/slide-source.js";
import action from "./control-slide-editor.js";

const sourceTsx = "export default function Slide() { return <h1>Saved</h1>; }";
const sourceHash = hashSlideSource(sourceTsx);
const validInput = {
  deckId: "deck-1",
  slideId: "slide-1",
  operation: "undo" as const,
  commandId: "command_123456",
  editorSessionId: "editor_session_1",
  historyVersion: 4,
  sourceRevision: 2,
  sourceHash,
};

function setCurrentStatus(overrides: Record<string, unknown> = {}) {
  mocks.appState.set("slides-2:slide-editor-status", {
    protocolVersion: 1,
    deckId: validInput.deckId,
    slideId: validInput.slideId,
    editorSessionId: validInput.editorSessionId,
    historyVersion: validInput.historyVersion,
    sourceRevision: validInput.sourceRevision,
    sourceHash: validInput.sourceHash,
    hasPendingEdits: true,
    canUndo: true,
    canRedo: false,
    canSave: true,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.clear();
  mocks.deckRow = {
    id: validInput.deckId,
    data: JSON.stringify({
      appId: "slides-2",
      slides: [
        {
          id: validInput.slideId,
          sourceTsx,
          revision: validInput.sourceRevision,
          sourceHash: validInput.sourceHash,
          content: "<h1>Saved</h1>",
        },
      ],
    }),
  };
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.getCurrentRequestBrowserTabId.mockReturnValue("tab_123");
  mocks.readAppStateForCurrentTab.mockImplementation(
    async (key: string) => mocks.appState.get(key) ?? null,
  );
  mocks.compareAndSetAppStateForCurrentTab.mockImplementation(
    async (
      key: string,
      expected: Record<string, unknown> | null,
      next: Record<string, unknown> | null,
    ) => {
      const current = mocks.appState.get(key) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      if (next) mocks.appState.set(key, next);
      else mocks.appState.delete(key);
      return true;
    },
  );
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => (mocks.deckRow ? [mocks.deckRow] : []),
      }),
    }),
  }));
  mocks.appState.set("navigation", {
    app: "slides-2",
    view: "editor",
    deckId: validInput.deckId,
    slideId: validInput.slideId,
  });
  setCurrentStatus();
});

describe("control-slide-editor", () => {
  it("requires a valid current tab and separately verifies deck editor access", async () => {
    mocks.getCurrentRequestBrowserTabId.mockReturnValue(null);

    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_tab_required",
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.compareAndSetAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("queues one command with exact editor, history, and source identity via CAS", async () => {
    const result = await action.run(validInput);

    expect(mocks.assertAccess).toHaveBeenCalledWith("deck", "deck-1", "editor");
    expect(mocks.readAppStateForCurrentTab).toHaveBeenCalledWith("navigation", {
      fallbackToGlobal: false,
    });
    expect(mocks.compareAndSetAppStateForCurrentTab).toHaveBeenCalledWith(
      "slides-2:slide-editor-command",
      null,
      expect.objectContaining({
        commandId: validInput.commandId,
        operation: "undo",
        editorSessionId: validInput.editorSessionId,
        historyVersion: validInput.historyVersion,
        sourceRevision: validInput.sourceRevision,
        sourceHash: validInput.sourceHash,
        status: "pending",
      }),
    );
    expect(result).toEqual({
      commandId: validInput.commandId,
      operation: "undo",
      status: "pending",
    });
    expect(JSON.stringify([...mocks.appState.values()])).not.toContain(
      sourceTsx,
    );
  });

  it("rejects stale tab navigation, editor session, history, and saved source", async () => {
    mocks.appState.set("navigation", {
      app: "slides-2",
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-other",
    });
    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_context_stale",
    });

    mocks.appState.set("navigation", {
      app: "slides-2",
      view: "editor",
      deckId: "deck-1",
      slideId: "slide-1",
    });
    setCurrentStatus({ editorSessionId: "new_editor_session" });
    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_state_stale",
    });

    setCurrentStatus({ historyVersion: validInput.historyVersion + 1 });
    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_state_stale",
    });

    setCurrentStatus();
    mocks.deckRow = {
      id: validInput.deckId,
      data: JSON.stringify({
        appId: "slides-2",
        slides: [
          {
            id: validInput.slideId,
            sourceTsx: `${sourceTsx} `,
            revision: validInput.sourceRevision + 1,
            sourceHash: hashSlideSource(`${sourceTsx} `),
          },
        ],
      }),
    };
    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_source_stale",
    });
    expect(mocks.compareAndSetAppStateForCurrentTab).not.toHaveBeenCalled();
  });

  it("rejects unavailable operations and concurrent pending commands", async () => {
    setCurrentStatus({ canUndo: false });
    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_command_unavailable",
    });

    setCurrentStatus();
    mocks.appState.set("slides-2:slide-editor-command", {
      protocolVersion: 1,
      commandId: "other_command_1",
      operation: "undo",
      deckId: validInput.deckId,
      slideId: validInput.slideId,
      editorSessionId: validInput.editorSessionId,
      historyVersion: validInput.historyVersion,
      sourceRevision: validInput.sourceRevision,
      sourceHash: validInput.sourceHash,
      status: "pending",
    });
    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_command_pending",
    });
  });

  it("returns the stored result for an exact command retry", async () => {
    const command = {
      protocolVersion: 1,
      ...validInput,
      status: "applied",
      completedAt: 123,
    };
    mocks.appState.set("slides-2:slide-editor-command", command);

    const result = await action.run(validInput);

    expect(result).toEqual({
      commandId: validInput.commandId,
      operation: "undo",
      status: "applied",
    });
    expect(mocks.compareAndSetAppStateForCurrentTab).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("fails if the compare-and-set loses a race", async () => {
    mocks.compareAndSetAppStateForCurrentTab.mockResolvedValueOnce(false);

    await expect(action.run(validInput)).rejects.toMatchObject({
      errorCode: "editor_command_conflict",
    });
  });
});

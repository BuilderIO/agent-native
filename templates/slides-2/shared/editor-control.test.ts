import { describe, expect, it } from "vitest";

import {
  completeSlideEditorCommand,
  isSlideEditorOperationAvailable,
  slideEditorCommandMatchesEditorState,
  slideEditorCommandSchema,
  slideEditorStatusSchema,
} from "./editor-control.js";

const status = slideEditorStatusSchema.parse({
  protocolVersion: 1,
  deckId: "deck-1",
  slideId: "slide-1",
  editorSessionId: "editor_session_1",
  historyVersion: 8,
  sourceRevision: 3,
  sourceHash: "a".repeat(64),
  hasPendingEdits: true,
  canUndo: true,
  canRedo: false,
  canSave: true,
});

const command = slideEditorCommandSchema.parse({
  protocolVersion: 1,
  commandId: "command_123456",
  operation: "undo",
  deckId: status.deckId,
  slideId: status.slideId,
  editorSessionId: status.editorSessionId,
  historyVersion: status.historyVersion,
  sourceRevision: status.sourceRevision,
  sourceHash: status.sourceHash,
  status: "pending",
});

describe("slide editor command bridge", () => {
  it.each([
    ["undo", true],
    ["redo", false],
    ["save", true],
  ] as const)(
    "reports %s availability from editor status",
    (operation, expected) => {
      expect(isSlideEditorOperationAvailable(status, operation)).toBe(expected);
    },
  );

  it("requires exact tab editor and source CAS identity before applying", () => {
    expect(
      slideEditorCommandMatchesEditorState(command, status, {
        deckId: status.deckId,
        slideId: status.slideId,
        editorSessionId: status.editorSessionId,
        historyVersion: status.historyVersion,
        sourceRevision: status.sourceRevision,
        sourceHash: status.sourceHash,
      }),
    ).toBe(true);

    for (const changed of [
      { editorSessionId: "another_session" },
      { historyVersion: status.historyVersion + 1 },
      { sourceRevision: status.sourceRevision + 1 },
      { sourceHash: "b".repeat(64) },
    ]) {
      expect(
        slideEditorCommandMatchesEditorState(command, status, {
          deckId: status.deckId,
          slideId: status.slideId,
          editorSessionId: status.editorSessionId,
          historyVersion: status.historyVersion,
          sourceRevision: status.sourceRevision,
          sourceHash: status.sourceHash,
          ...changed,
        }),
      ).toBe(false);
    }

    expect(
      slideEditorCommandMatchesEditorState(
        { ...command, status: "applied" },
        status,
        {
          deckId: status.deckId,
          slideId: status.slideId,
          editorSessionId: status.editorSessionId,
          historyVersion: status.historyVersion,
          sourceRevision: status.sourceRevision,
          sourceHash: status.sourceHash,
        },
      ),
    ).toBe(false);
  });

  it("stores only the bounded command result and preserves its identity", () => {
    const result = completeSlideEditorCommand(
      command,
      { status: "rejected", failureCode: "stale_editor_state" },
      456,
    );

    expect(result).toMatchObject({
      commandId: command.commandId,
      operation: "undo",
      deckId: command.deckId,
      slideId: command.slideId,
      editorSessionId: command.editorSessionId,
      historyVersion: command.historyVersion,
      sourceRevision: command.sourceRevision,
      sourceHash: command.sourceHash,
      status: "rejected",
      completedAt: 456,
      failureCode: "stale_editor_state",
    });
    expect(result).not.toHaveProperty("sourceTsx");
  });
});

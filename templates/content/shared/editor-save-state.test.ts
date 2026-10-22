import { describe, expect, it } from "vitest";

import {
  claimedEditorSave,
  editorSaveState,
  publishesEditorSaveState,
} from "./editor-save-state";

const REVISION = "body:4:sha256:" + "a".repeat(64);

function input(overrides: Partial<Parameters<typeof editorSaveState>[0]> = {}) {
  return {
    saveQueued: false,
    saveInFlight: false,
    recoveryPending: false,
    localTitle: "Title",
    localContent: "Body.",
    savedTitle: { title: "Title", updatedAt: "2026-10-17T12:00:00.000Z" },
    savedContent: { content: "Body.", revision: REVISION },
    ...overrides,
  };
}

const UNSAVED = {
  unsavedEdits: true,
  savedRevision: null,
  savedTitle: null,
  savedTitleAt: null,
};

describe("editorSaveState", () => {
  it("reports the acknowledged save when the editor holds exactly that", () => {
    expect(editorSaveState(input())).toEqual({
      unsavedEdits: false,
      savedRevision: REVISION,
      savedTitle: "Title",
      savedTitleAt: "2026-10-17T12:00:00.000Z",
    });
  });

  it.each([
    ["a queued save", { saveQueued: true }],
    ["a save in flight", { saveInFlight: true }],
    ["a retained recovery draft", { recoveryPending: true }],
    ["an unsaved title", { localTitle: "Title edited" }],
    ["unsaved body text", { localContent: "Body. More" }],
    [
      "a body without an acknowledged revision",
      { savedContent: { content: "Body.", revision: undefined } },
    ],
  ])("reports unsaved edits for %s", (_label, overrides) => {
    expect(editorSaveState(input(overrides))).toEqual(UNSAVED);
  });
});

describe("claimedEditorSave", () => {
  it("reads a full saved claim", () => {
    expect(
      claimedEditorSave({
        unsavedEdits: false,
        savedRevision: REVISION,
        savedTitle: "Title",
        savedTitleAt: null,
      }),
    ).toEqual({ revision: REVISION, title: "Title", titleUpdatedAt: null });
  });

  it.each([
    ["an older editor without the fields", {}],
    ["an editor with unsaved edits", UNSAVED],
    [
      "a claim without a revision",
      { unsavedEdits: false, savedRevision: null, savedTitle: "Title" },
    ],
    [
      "a claim with a malformed title time",
      {
        unsavedEdits: false,
        savedRevision: REVISION,
        savedTitle: "Title",
        savedTitleAt: 42,
      },
    ],
  ])("claims nothing for %s", (_label, state) => {
    expect(claimedEditorSave(state)).toBeNull();
  });
});

describe("publishesEditorSaveState", () => {
  it("matches only an awareness state that already carries every field", () => {
    const state = editorSaveState(input());
    expect(publishesEditorSaveState({ user: {}, ...state }, state)).toBe(true);
    expect(
      publishesEditorSaveState(
        {
          user: {},
          ...state,
          savedRevision: "body:3:sha256:" + "b".repeat(64),
        },
        state,
      ),
    ).toBe(false);
    expect(publishesEditorSaveState({ user: {} }, state)).toBe(false);
  });
});

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";

import { isRemoteCollaborativeTransaction } from "./useCollabReconcile.js";

const schema = new Schema({
  nodes: {
    doc: { content: "text*" },
    text: {},
  },
});

describe("collaborative transaction ownership", () => {
  it("persists local Yjs undo and redo while ignoring remote updates", () => {
    const state = EditorState.create({ schema });
    expect(isRemoteCollaborativeTransaction(state.tr)).toBe(false);
    expect(
      isRemoteCollaborativeTransaction(
        state.tr.setMeta(ySyncPluginKey, { isUndoRedoOperation: false }),
      ),
    ).toBe(true);
    expect(
      isRemoteCollaborativeTransaction(
        state.tr.setMeta(ySyncPluginKey, { isUndoRedoOperation: true }),
      ),
    ).toBe(false);
  });
});

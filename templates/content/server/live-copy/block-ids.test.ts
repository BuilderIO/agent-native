import { prosemirrorToYXmlFragment } from "@tiptap/y-tiptap";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  BLOCK_IDENTITY_ATTR,
  editorBlockIdsOf,
} from "../../shared/block-identity-ids.js";
import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema.js";
import { LIVE_BODY_FIELD } from "../../shared/live-body.js";
import { nfmToDoc, type PMNode } from "../../shared/nfm.js";
import { liveCopyBlockIds } from "./block-ids.js";
import { CONTENT_BLOCK_IDS_TASK } from "./task-names.js";
import { tasks } from "./tasks.js";

const worker = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock("@agent-native/core/collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/collab")>()),
  createBoundedTaskRunner: () => worker,
}));

const schema = createContentEditorStructuralSchema();

function stateOf(markdown: string, ids: string[]) {
  const json = nfmToDoc(markdown) as PMNode;
  const stamped = {
    ...json,
    content: (json.content ?? []).map((node, index) =>
      ids[index]
        ? {
            ...node,
            attrs: { ...node.attrs, [BLOCK_IDENTITY_ATTR]: ids[index] },
          }
        : node,
    ),
  };
  const doc = new Y.Doc();
  prosemirrorToYXmlFragment(
    schema.nodeFromJSON(stamped),
    doc.getXmlFragment(LIVE_BODY_FIELD),
  );
  return { state: Y.encodeStateAsUpdate(doc), stamped };
}

describe("block IDs on the live copy", () => {
  it("reads the IDs an editor's commit holds, by path", async () => {
    const { state, stamped } = stateOf("# Title\nApples\nPears", [
      "block_title",
      "",
      "block_pears",
    ]);

    await expect(tasks[CONTENT_BLOCK_IDS_TASK]({ state })).resolves.toEqual(
      editorBlockIdsOf(stamped),
    );
    await expect(tasks[CONTENT_BLOCK_IDS_TASK]({ state })).resolves.toEqual({
      shape: expect.any(String),
      idsByPath: { "0": "block_title", "2": "block_pears" },
    });
  });

  it("reads nothing from a state without a body", async () => {
    const state = Y.encodeStateAsUpdate(new Y.Doc());

    await expect(tasks[CONTENT_BLOCK_IDS_TASK]({ state })).resolves.toBeNull();
  });

  it("lets the save go on without IDs when the worker fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    worker.run.mockRejectedValueOnce(new Error("worker exited"));
    worker.run.mockResolvedValueOnce({ shape: 7 });
    try {
      const { state } = stateOf("Apples", ["block_apples"]);
      await expect(liveCopyBlockIds(state)).resolves.toBeNull();
      await expect(liveCopyBlockIds(state)).resolves.toBeNull();
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});

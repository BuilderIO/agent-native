import { prosemirrorToYXmlFragment } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  BLOCK_IDENTITY_ATTR,
  editorBlockIdsOf,
} from "../../shared/block-identity-ids.js";
import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema.js";
import { LIVE_BODY_FIELD } from "../../shared/live-body.js";
import { nfmToDoc, type PMNode } from "../../shared/nfm.js";
import { CONTENT_BLOCK_IDS_TASK } from "./task-names.js";
import { tasks } from "./tasks.js";

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
});

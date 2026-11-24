import { describe, expect, it } from "vitest";

import {
  BLOCK_IDENTITY_ATTR,
  BLOCK_IDENTITY_NODE_TYPES,
  blockIdentityIdsByPath,
  editorBlockIdsForSavedText,
  knownBlockIdsByPath,
} from "./block-identity-ids.js";
import {
  BLOCKS_FIELD_BLOCK_KINDS,
  blocksFieldPathsById,
  blocksFieldTreeShape,
  catchUpBlocksFieldIdentity,
  exposeBlocksFieldIdentity,
  legacyBlocksFieldIdentity,
  materializeLegacyBlocksFieldIdentity,
  reconcileBlocksFieldIdentity,
  snapshotBlocksFieldMarkdown,
  type StoredBlocksFieldIdentity,
} from "./blocks-field-identity.js";
import { docToNfm, nfmToDoc, type PMNode } from "./nfm.js";

const L = (...lines: string[]) => lines.join("\n");

const EVERY_KIND = L(
  "# Heading",
  "Paragraph with **bold**",
  "> Quote",
  "- List item",
  "\t- Nested item",
  "1. Numbered",
  "[ ] Task",
  "---",
  "```ts",
  "const stable = true",
  "```",
  '<callout icon="💡">',
  "\tInside",
  "</callout>",
  "<details>",
  "<summary>A toggle</summary>",
  "\tHidden child",
  "</details>",
  "<columns>",
  "\t<column>",
  "\t\tLeft",
  "\t</column>",
  "\t<column>",
  "\t\tRight",
  "\t</column>",
  "</columns>",
  "<table>",
  "<tr>",
  "<td>a</td>",
  "<td>b</td>",
  "</tr>",
  "</table>",
  "![A caption](https://cdn.example.com/x.png)",
  '<synced_block url="https://www.notion.so/s">',
  "\tShared",
  "</synced_block>",
);

function stampEveryNode(node: PMNode, ids: () => string): PMNode {
  const stamped = {
    ...node,
    attrs: { ...node.attrs, [BLOCK_IDENTITY_ATTR]: ids() },
  };
  return node.content
    ? {
        ...stamped,
        content: node.content.map((child) => stampEveryNode(child, ids)),
      }
    : stamped;
}

function stampByPath(
  markdown: string,
  idsByPath: Record<string, string>,
): PMNode {
  const tracked = new Set<string>(BLOCKS_FIELD_BLOCK_KINDS);
  const addressable = new Set(BLOCK_IDENTITY_NODE_TYPES);
  const stamp = (nodes: PMNode[], parentPath: string | null): PMNode[] => {
    let position = 0;
    return nodes.map((node): PMNode => {
      if (!tracked.has(node.type)) return node;
      const path =
        parentPath === null ? `${position}` : `${parentPath}.${position}`;
      position++;
      const id = addressable.has(node.type) ? idsByPath[path] : undefined;
      const stamped: PMNode = id
        ? { ...node, attrs: { ...node.attrs, [BLOCK_IDENTITY_ATTR]: id } }
        : { ...node };
      return node.content
        ? { ...stamped, content: stamp(node.content, path) }
        : stamped;
    });
  };
  const doc = nfmToDoc(markdown) as PMNode;
  return { ...doc, content: stamp(doc.content ?? [], null) };
}

function liveIds(identity: StoredBlocksFieldIdentity) {
  return identity.blocks
    .filter((block) => block.state === "live")
    .map((block) => block.id);
}

function byPath(...ids: (string | undefined)[]): Record<string, string> {
  return Object.fromEntries(
    ids.flatMap((id, index) => (id === undefined ? [] : [[`${index}`, id]])),
  );
}

function pathOf(paths: ReadonlyMap<string, string>, id: string) {
  const path = paths.get(id);
  if (path === undefined) throw new Error(`Expected ${id} to have a path`);
  return path;
}

function save(
  previous: StoredBlocksFieldIdentity,
  markdown: string,
  editorIdsByPath: Record<string, string>,
) {
  let next = 0;
  return reconcileBlocksFieldIdentity({
    documentId: "doc-1",
    propertyId: "content",
    previous,
    markdown,
    createId: () => `new_block_${++next}`,
    preferredIdsByPath: knownBlockIdsByPath(previous, editorIdsByPath),
  });
}

describe("block identity IDs", () => {
  it("never writes the editor's IDs into the page's Markdown", () => {
    let next = 0;
    const doc = nfmToDoc(EVERY_KIND) as PMNode;
    const stamped = stampEveryNode(doc, () => `block_${++next}`);

    expect(docToNfm(stamped)).toBe(docToNfm(doc));
    expect(docToNfm(stamped)).not.toContain("block_");
  });

  it("names every tracked block by the path the table gives it", () => {
    const identity = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: EVERY_KIND,
    });
    const paths = blocksFieldPathsById(identity.blocks);
    const snapshotPaths = snapshotBlocksFieldMarkdown(EVERY_KIND).map(
      (snapshot) => snapshot.path,
    );

    expect(identity.blocks.map((block) => paths.get(block.id))).toEqual(
      snapshotPaths,
    );
  });

  it("reads the IDs a tree carries by path, skipping lists and table rows", () => {
    const identity = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: EVERY_KIND,
    });
    const paths = blocksFieldPathsById(identity.blocks);
    const idsByPath = Object.fromEntries(
      identity.blocks.map((block) => [pathOf(paths, block.id), block.id]),
    );
    const read = blockIdentityIdsByPath(stampByPath(EVERY_KIND, idsByPath));

    const addressable = identity.blocks.filter((block) => block.addressable);
    expect(Object.keys(read).sort()).toEqual(
      addressable.map((block) => pathOf(paths, block.id)).sort(),
    );
    for (const block of addressable) {
      expect(read[pathOf(paths, block.id)]).toBe(block.id);
    }
  });

  it("names neither block when two carry the same ID", () => {
    const read = blockIdentityIdsByPath(
      stampByPath(L("one", "two", "three"), {
        "0": "block_a",
        "1": "block_a",
        "2": "block_c",
      }),
    );

    expect(read).toEqual({ "2": "block_c" });
  });

  it("drops IDs the field never gave out", () => {
    const previous = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: L("one", "two"),
    });
    const [oneId] = liveIds(previous);

    expect(
      knownBlockIdsByPath(previous, {
        ...byPath(oneId),
        "1": "block_elsewhere",
      }),
    ).toEqual({ "0": oneId });
  });

  it("moves the editor's IDs onto saved text by content the two share once", () => {
    const shapeOf = (markdown: string) =>
      blocksFieldTreeShape(nfmToDoc(markdown) as PMNode);
    const editorMarkdown = L("Beta", "Alpha", "Note", "Note", "Gamma");
    const ids = {
      shape: shapeOf(editorMarkdown),
      idsByPath: byPath(
        "block_a",
        "block_b",
        "block_n1",
        "block_n2",
        "block_c",
      ),
    };
    const savedMarkdown = L(
      "Intro",
      "Beta",
      "Alpha",
      "Note",
      "Note",
      "Gamma 2",
    );

    expect(
      editorBlockIdsForSavedText({
        editorMarkdown,
        savedMarkdown: editorMarkdown,
        ids,
      }),
    ).toBe(ids);
    expect(
      editorBlockIdsForSavedText({ editorMarkdown, savedMarkdown, ids }),
    ).toEqual({
      shape: shapeOf(savedMarkdown),
      idsByPath: byPath(undefined, "block_a", "block_b"),
    });
    expect(
      editorBlockIdsForSavedText({
        editorMarkdown,
        savedMarkdown,
        ids: { ...ids, shape: "shape_of_another_tree" },
      }),
    ).toBeUndefined();
  });

  it("drops an ID the editor names at two places", () => {
    const previous = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: L("one", "two", "three"),
    });
    const [oneId, , threeId] = liveIds(previous);

    expect(
      knownBlockIdsByPath(previous, byPath(oneId, oneId, threeId)),
    ).toEqual(byPath(undefined, undefined, threeId));
  });

  it("keeps a block's ID through a rewrite and a change of type", () => {
    const previous = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: L("Apples ripen in late summer.", "Pears bruise easily."),
    });
    const [applesId, pearsId] = liveIds(previous);
    const next = save(
      previous,
      L("# Nothing alike now", "Pears bruise easily."),
      byPath(applesId, pearsId),
    );

    expect(liveIds(next)).toEqual([applesId, pearsId]);
    expect(next.blocks[0]?.kind).toBe("heading");
  });

  it("follows the editor when two blocks trade text", () => {
    const previous = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: L("Apples ripen in late summer.", "Pears bruise easily."),
    });
    const [applesId, pearsId] = liveIds(previous);
    const next = save(
      previous,
      L("Pears bruise easily.", "Apples ripen in late summer."),
      byPath(applesId, pearsId),
    );

    expect(liveIds(next)).toEqual([applesId, pearsId]);
    expect(next.blocks.some((block) => block.state === "deleted")).toBe(false);
  });

  it("brings a deleted block's ID back when undo restores it", () => {
    const initial = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: L("Apples ripen in late summer.", "Pears bruise easily."),
    });
    const [applesId, pearsId] = liveIds(initial);
    const deleted = save(initial, "Pears bruise easily.", byPath(pearsId));
    expect(liveIds(deleted)).toEqual([pearsId]);

    const restored = save(
      deleted,
      L("Apples ripen in late autumn.", "Pears bruise easily."),
      byPath(applesId, pearsId),
    );

    expect(liveIds(restored)).toEqual([applesId, pearsId]);
    expect(restored.blocks[0]?.recoveredAtRevision).toBe(restored.revision);
    expect(
      restored.blocks.filter((block) => block.state === "deleted"),
    ).toEqual([]);
  });

  it("gives a split's second half its own ID", () => {
    const previous = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Apples ripen in late summer. Pears bruise easily.",
    });
    const [firstId] = liveIds(previous);
    const next = save(
      previous,
      L("Apples ripen in late summer.", "Pears bruise easily."),
      byPath(firstId),
    );

    expect(liveIds(next)[0]).toBe(firstId);
    expect(liveIds(next)[1]).not.toBe(firstId);
    expect(new Set(liveIds(next)).size).toBe(2);
  });

  it("gives a stale table's new blocks the same IDs on every read, and a save keeps them", () => {
    const stored = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "one",
    });
    const body = L("one", "two");
    const first = exposeBlocksFieldIdentity(stored, body);
    const second = exposeBlocksFieldIdentity(stored, body);
    expect(second.blocks.map((block) => block.id)).toEqual(
      first.blocks.map((block) => block.id),
    );

    const [oneId, twoId] = first.blocks.map((block) => block.id);
    const next = save(
      catchUpBlocksFieldIdentity(stored, body),
      L("two", "one"),
      byPath(twoId, oneId),
    );
    expect(liveIds(next)).toEqual([twoId, oneId]);
  });
});

import { describe, expect, it } from "vitest";

import {
  BLOCKS_FIELD_BLOCK_KINDS,
  BLOCKS_FIELD_OPERATION_CAPABILITIES,
  exposeBlocksFieldIdentity,
  legacyBlocksFieldIdentity,
  materializeLegacyBlocksFieldIdentity,
  reconcileBlocksFieldIdentity,
} from "./blocks-field-identity.js";
import { mutateBlocksFieldDocument } from "./database-block-mutations.js";

function identity(markdown: string) {
  return legacyBlocksFieldIdentity({
    documentId: "document-1",
    propertyId: "property-1",
    markdown,
  });
}

function persisted(markdown: string) {
  return materializeLegacyBlocksFieldIdentity({
    documentId: "document-1",
    propertyId: "property-1",
    markdown,
  });
}

describe("individual Blocks-field document mutations", () => {
  const fullyMutableKinds = [
    ["paragraph", "Paragraph"],
    ["heading", "# Heading"],
    ["horizontalRule", "---"],
    ["codeBlock", "```ts\nconst value = 1;\n```"],
    ["blockquote", "> Quote"],
    [
      "notionToggle",
      "<details>\n<summary>Toggle</summary>\n\tChild\n</details>",
    ],
    ["notionCallout", "<callout>\n\tCallout\n</callout>"],
    [
      "notionColumns",
      "<columns>\n\t<column>\n\t\tColumn\n\t</column>\n</columns>",
    ],
    ["notionColumn", "<column>\n\tColumn\n</column>"],
    [
      "notionSyncedBlock",
      '<synced_block url="https://example.com/s">\n\tShared\n</synced_block>',
    ],
    [
      "table",
      '<table header-row="true">\n<tr>\n<td>Header</td>\n</tr>\n</table>',
    ],
    ["image", "![Diagram](https://example.com/image.png)"],
    ["video", '<video src="https://example.com/video.mp4">Clip</video>'],
    ["audio", '<audio src="https://example.com/audio.mp3">Clip</audio>'],
    ["notionBlockAtom", '<page url="https://example.com/page">Page</page>'],
    [
      "registryBlock",
      '<Endpoint id="endpoint-1" method="GET" path="/widgets" />',
    ],
    [
      "contentReference",
      '<ContentReference sourcePath="../source.mdx" title="Source" />',
    ],
    ["localMdxComponent", '<ProjectCard title="Example" />'],
  ] as const;

  it("declares an explicit operation matrix for every indexed block kind", () => {
    expect(Object.keys(BLOCKS_FIELD_OPERATION_CAPABILITIES).sort()).toEqual(
      [...BLOCKS_FIELD_BLOCK_KINDS].sort(),
    );
    expect(BLOCKS_FIELD_OPERATION_CAPABILITIES.paragraph).toEqual([
      "insert",
      "update",
      "upsert",
      "delete",
      "reorder",
    ]);
    expect(BLOCKS_FIELD_OPERATION_CAPABILITIES.listItem).toEqual([
      "delete",
      "reorder",
    ]);
    expect(BLOCKS_FIELD_OPERATION_CAPABILITIES.tableCell).toEqual([]);
  });

  it("inserts one block without changing either sibling ID", () => {
    const markdown = "Alpha\nBeta";
    const before = identity(markdown);
    const changed = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: {
        operation: "insert",
        block: { kind: "paragraph", nfm: "Middle" },
        position: { placement: "before", anchorBlockId: before.blocks[1]!.id },
      },
      insertedBlockId: "block_requested",
    });
    expect(changed.markdown).toBe("Alpha\nMiddle\nBeta");
    const next = reconcileBlocksFieldIdentity({
      documentId: "document-1",
      propertyId: "property-1",
      previous: persisted(markdown),
      markdown: changed.markdown,
      preferredIdsByPath: changed.preferredIdsByPath,
      createId: () => "unexpected",
    });
    expect(
      next.blocks
        .filter((block) => block.state === "live")
        .map((block) => block.id),
    ).toEqual([before.blocks[0]!.id, "block_requested", before.blocks[1]!.id]);
  });

  it("keeps exact IDs when inserting among indistinguishable siblings", () => {
    const markdown = "Same\nSame";
    const before = identity(markdown);
    const changed = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: {
        operation: "insert",
        block: { kind: "paragraph", nfm: "Same" },
        position: { placement: "before", anchorBlockId: before.blocks[1]!.id },
      },
      insertedBlockId: "block_exact_middle",
    });
    const next = reconcileBlocksFieldIdentity({
      documentId: "document-1",
      propertyId: "property-1",
      previous: persisted(markdown),
      markdown: changed.markdown,
      preferredIdsByPath: changed.preferredIdsByPath,
      createId: () => "unexpected",
    });
    expect(
      next.blocks
        .filter((block) => block.state === "live")
        .map((block) => block.id),
    ).toEqual([
      before.blocks[0]!.id,
      "block_exact_middle",
      before.blocks[1]!.id,
    ]);
  });

  it("updates one block by ID and preserves its sibling bytes and IDs", () => {
    const markdown = "Alpha\nBeta";
    const before = identity(markdown);
    const changed = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: {
        operation: "update",
        blockId: before.blocks[0]!.id,
        block: { kind: "paragraph", nfm: "Completely rewritten" },
      },
    });
    expect(changed.markdown).toBe("Completely rewritten\nBeta");
    expect(changed.preferredIdsByPath).toMatchObject({
      "0": before.blocks[0]!.id,
      "1": before.blocks[1]!.id,
    });
  });

  it("deletes one identified block and reports only its subtree candidates", () => {
    const markdown = "Alpha\nBeta\nGamma";
    const before = identity(markdown);
    const changed = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: { operation: "delete", blockId: before.blocks[1]!.id },
    });
    expect(changed.markdown).toBe("Alpha\nGamma");
    expect(changed.deletedCandidateIds).toEqual([before.blocks[1]!.id]);
  });

  it("deletes a container as one operation while identifying its full subtree", () => {
    const markdown = "<callout>\n\tChild\n</callout>\nSibling";
    const before = identity(markdown);
    const callout = before.blocks.find(
      (block) => block.kind === "notionCallout",
    )!;
    const child = before.blocks.find((block) => block.parentId === callout.id)!;
    const changed = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: { operation: "delete", blockId: callout.id },
    });
    expect(changed.markdown).toBe("Sibling");
    expect(changed.deletedCandidateIds).toEqual([callout.id, child.id]);
  });

  it("keeps every deleted subtree ID tombstoned after an identical fresh insert", () => {
    const insertedMarkdown = "<callout>\n\tChild\n</callout>";
    const markdown = `${insertedMarkdown}\nSibling`;
    let stored = persisted(markdown);
    const before = exposeBlocksFieldIdentity(stored, markdown);
    const oldIds = before.blocks.map((block) => block.id);
    const deleted = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: { operation: "delete", blockId: before.blocks[0]!.id },
    });
    stored = reconcileBlocksFieldIdentity({
      documentId: "document-1",
      propertyId: "property-1",
      previous: stored,
      markdown: deleted.markdown,
      preferredIdsByPath: deleted.preferredIdsByPath,
      createId: () => "unexpected-delete-id",
    });
    const deletedIdentity = exposeBlocksFieldIdentity(stored, deleted.markdown);
    let descendantIndex = 0;
    const inserted = mutateBlocksFieldDocument({
      markdown: deleted.markdown,
      identity: deletedIdentity,
      mutation: {
        operation: "insert",
        block: { kind: "notionCallout", nfm: insertedMarkdown },
        position: { placement: "start" },
      },
      insertedBlockId: "fresh-callout",
      createInsertedDescendantId: () => `fresh-child-${descendantIndex++}`,
    });
    stored = reconcileBlocksFieldIdentity({
      documentId: "document-1",
      propertyId: "property-1",
      previous: stored,
      markdown: inserted.markdown,
      preferredIdsByPath: inserted.preferredIdsByPath,
      createId: () => "unexpected-insert-id",
    });

    const liveIds = stored.blocks
      .filter((block) => block.state === "live")
      .map((block) => block.id);
    const tombstoneIds = stored.blocks
      .filter((block) => block.state === "deleted")
      .map((block) => block.id);
    expect(liveIds).toEqual(
      expect.arrayContaining(["fresh-callout", "fresh-child-0"]),
    );
    expect(liveIds).not.toEqual(expect.arrayContaining(oldIds.slice(0, 2)));
    expect(tombstoneIds).toEqual(expect.arrayContaining(oldIds.slice(0, 2)));
  });

  it("reorders within one parent while retaining every stable ID", () => {
    const markdown = "Alpha\nBeta\nGamma";
    const before = identity(markdown);
    const changed = mutateBlocksFieldDocument({
      markdown,
      identity: before,
      mutation: {
        operation: "reorder",
        blockId: before.blocks[2]!.id,
        position: { placement: "before", anchorBlockId: before.blocks[0]!.id },
      },
    });
    expect(changed.markdown).toBe("Gamma\nAlpha\nBeta");
    expect(Object.values(changed.preferredIdsByPath).sort()).toEqual(
      before.blocks.map((block) => block.id).sort(),
    );
  });

  it("rejects unsupported structural updates and kind conversion", () => {
    const list = identity("- one\n- two");
    const listItem = list.blocks.find((block) => block.kind === "listItem")!;
    expect(() =>
      mutateBlocksFieldDocument({
        markdown: "- one\n- two",
        identity: list,
        mutation: {
          operation: "update",
          blockId: listItem.id,
          block: { kind: "listItem", nfm: "- changed" },
        },
      }),
    ).toThrow('Block kind "listItem" does not support update.');

    const paragraph = identity("Alpha");
    expect(() =>
      mutateBlocksFieldDocument({
        markdown: "Alpha",
        identity: paragraph,
        mutation: {
          operation: "update",
          blockId: paragraph.blocks[0]!.id,
          block: { kind: "heading", nfm: "# Alpha" },
        },
      }),
    ).toThrow("cannot change block kind");
  });

  it("rejects cross-parent reorder without changing either container", () => {
    const markdown =
      "<callout>\n\tFirst child\n</callout>\n<callout>\n\tSecond child\n</callout>";
    const before = identity(markdown);
    const children = before.blocks.filter((block) => block.parentId !== null);
    expect(() =>
      mutateBlocksFieldDocument({
        markdown,
        identity: before,
        mutation: {
          operation: "reorder",
          blockId: children[0]!.id,
          position: { placement: "before", anchorBlockId: children[1]!.id },
        },
      }),
    ).toThrow("Cross-parent block reorder is not supported.");
  });

  it.each(fullyMutableKinds)(
    "executes every declared individual operation for live %s blocks",
    (kind, markdown) => {
      const fieldMarkdown =
        kind === "notionColumn"
          ? "<columns>\n\t<column>\n\t\tFirst\n\t</column>\n\t<column>\n\t\tSecond\n\t</column>\n</columns>"
          : `${markdown}\nTail`;
      let stored = persisted(fieldMarkdown);
      let before = exposeBlocksFieldIdentity(stored, fieldMarkdown);
      const block = before.blocks.find((candidate) => candidate.kind === kind);
      expect(
        block,
        `${kind} must be indexed by the identity contract`,
      ).toBeTruthy();

      const insertedId = `inserted_${kind}`;
      let generatedId = 0;
      const createId = () => `generated_${kind}_${generatedId++}`;
      const inserted = mutateBlocksFieldDocument({
        markdown: fieldMarkdown,
        identity: before,
        mutation: {
          operation: "insert",
          block: { kind, nfm: markdown },
          position: { placement: "after", anchorBlockId: block!.id },
        },
        insertedBlockId: insertedId,
        createInsertedDescendantId: createId,
      });
      expect(inserted.changed).toBe(true);
      stored = reconcileBlocksFieldIdentity({
        documentId: "document-1",
        propertyId: "property-1",
        previous: stored,
        markdown: inserted.markdown,
        preferredIdsByPath: inserted.preferredIdsByPath,
        createId,
      });
      before = exposeBlocksFieldIdentity(stored, inserted.markdown);
      expect(
        before.blocks.some((candidate) => candidate.id === insertedId),
      ).toBe(true);

      for (const operation of ["update", "upsert"] as const) {
        expect(() =>
          mutateBlocksFieldDocument({
            markdown: inserted.markdown,
            identity: before,
            mutation: {
              operation,
              blockId: insertedId,
              block: { kind, nfm: markdown },
            },
          }),
        ).not.toThrow();
      }

      const reordered = mutateBlocksFieldDocument({
        markdown: inserted.markdown,
        identity: before,
        mutation: {
          operation: "reorder",
          blockId: insertedId,
          position: { placement: "before", anchorBlockId: block!.id },
        },
      });
      expect(reordered.changed).toBe(true);
      stored = reconcileBlocksFieldIdentity({
        documentId: "document-1",
        propertyId: "property-1",
        previous: stored,
        markdown: reordered.markdown,
        preferredIdsByPath: reordered.preferredIdsByPath,
        createId,
      });
      before = exposeBlocksFieldIdentity(stored, reordered.markdown);
      const deleted = mutateBlocksFieldDocument({
        markdown: reordered.markdown,
        identity: before,
        mutation: { operation: "delete", blockId: insertedId },
      });
      expect(deleted.changed).toBe(true);
      expect(deleted.deletedCandidateIds).toContain(insertedId);
    },
  );
});

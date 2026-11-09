import { describe, expect, it } from "vitest";

import {
  BLOCK_TOMBSTONE_REVISION_WINDOW,
  MAX_BLOCK_TOMBSTONES_PER_FIELD,
  blocksFieldId,
  exposeBlocksFieldIdentity,
  legacyBlocksFieldIdentity,
  materializeLegacyBlocksFieldIdentity,
  reconcileBlocksFieldIdentity,
  type StoredBlocksFieldIdentity,
} from "./blocks-field-identity.js";

function idFactory() {
  let next = 0;
  return () => `new_block_${++next}`;
}

describe("Blocks field identity", () => {
  it("assigns deterministic but field-scoped identities without changing NFM", () => {
    const first = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Alpha\nBeta",
    });
    const repeated = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Alpha\nBeta",
    });
    const additional = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "notes",
      markdown: "Alpha\nBeta",
    });

    expect(repeated).toEqual(first);
    expect(additional.fieldId).not.toBe(first.fieldId);
    expect(additional.blocks.map((block) => block.id)).not.toEqual(
      first.blocks.map((block) => block.id),
    );
    expect(first.revision).toBe(0);
    expect(first.identityStatus).toBe("legacy");
  });

  it("materializes ordinary Markdown details bodies as toggle children", () => {
    const identity = legacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: [
        "<details>",
        "<summary>Toggle</summary>",
        "Paragraph",
        "## Heading",
        "- item",
        "</details>",
      ].join("\n"),
    });
    const [toggle, ...children] = identity.blocks;

    expect(toggle?.kind).toBe("notionToggle");
    expect(children.map((block) => block.kind)).toEqual([
      "paragraph",
      "heading",
      "bulletList",
      "listItem",
      "paragraph",
    ]);
    expect(children.map((block) => block.parentId)).toEqual([
      toggle?.id,
      toggle?.id,
      toggle?.id,
      children[2]?.id,
      children[3]?.id,
    ]);
  });

  it("field-scopes identical preferred and generated IDs at first materialization", () => {
    const markdown = '<registry-block blockId="shared-id" />';
    const first = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown,
    });
    const second = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "notes",
      markdown,
    });

    expect(first.blocks[0]?.id).not.toBe(second.blocks[0]?.id);

    const firstInserted = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        markdown: "",
      }),
      markdown: "New block",
      createId: () => "same-generated-id",
    });
    const secondInserted = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "notes",
      previous: materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "notes",
        markdown: "",
      }),
      markdown: "New block",
      createId: () => "same-generated-id",
    });
    expect(firstInserted.blocks[0]?.id).not.toBe(secondInserted.blocks[0]?.id);
  });

  it("preserves IDs through edit, reorder, insertion, split, and merge rules", () => {
    const createId = idFactory();
    const initial = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Alpha\nBeta",
    });
    const [alphaId, betaId] = initial.blocks.map((block) => block.id);

    const edited = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: initial,
      markdown: "Alpha edited\nBeta",
      createId,
    });
    expect(
      edited.blocks
        .filter((block) => block.state === "live")
        .map((block) => block.id),
    ).toEqual([alphaId, betaId]);

    const reordered = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: edited,
      markdown: "Beta\nAlpha edited",
      createId,
    });
    expect(
      reordered.blocks
        .filter((block) => block.state === "live")
        .map((block) => block.id),
    ).toEqual([betaId, alphaId]);

    const inserted = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: reordered,
      markdown: "Intro\nBeta\nAlpha edited",
      createId,
    });
    const insertedLive = inserted.blocks.filter(
      (block) => block.state === "live",
    );
    expect(insertedLive.slice(1).map((block) => block.id)).toEqual([
      betaId,
      alphaId,
    ]);

    const split = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: inserted,
      markdown: "In\ntro\nBeta\nAlpha edited",
      createId,
    });
    const splitLive = split.blocks.filter((block) => block.state === "live");
    expect(splitLive[0]?.id).toBe(insertedLive[0]?.id);
    expect(splitLive[1]?.id).not.toBe(insertedLive[0]?.id);

    const merged = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: split,
      markdown: "Intro\nBeta\nAlpha edited",
      createId,
    });
    const mergedPublic = exposeBlocksFieldIdentity(
      merged,
      "Intro\nBeta\nAlpha edited",
    );
    expect(mergedPublic.blocks[0]?.id).toBe(splitLive[0]?.id);
    expect(mergedPublic.tombstones).toContainEqual(
      expect.objectContaining({ id: splitLive[1]?.id }),
    );
  });

  it("reserves a deleted ID and recovers it only for an exact tombstoned block", () => {
    const createId = idFactory();
    const initial = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Keep\nRecover me",
    });
    const recoverId = initial.blocks[1]!.id;
    const deleted = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: initial,
      markdown: "Keep",
      createId,
    });
    expect(
      exposeBlocksFieldIdentity(deleted, "Keep").tombstones,
    ).toContainEqual(
      expect.objectContaining({ id: recoverId, deletedAtRevision: 1 }),
    );

    const recovered = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: deleted,
      markdown: "Keep\nRecover me",
      createId,
    });
    expect(
      exposeBlocksFieldIdentity(recovered, "Keep\nRecover me").blocks.map(
        (block) => block.id,
      ),
    ).toContain(recoverId);
    expect(
      exposeBlocksFieldIdentity(recovered, "Keep\nRecover me").tombstones,
    ).not.toContainEqual(expect.objectContaining({ id: recoverId }));
  });

  it("consumes a tombstone once when identical blocks are restored", () => {
    const initial = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Keep\nRepeat",
    });
    const repeatId = initial.blocks[1]!.id;
    const deleted = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: initial,
      markdown: "Keep",
      createId: idFactory(),
    });
    const restoredTwice = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: deleted,
      markdown: "Keep\nRepeat\nRepeat",
      createId: idFactory(),
    });
    const repeatIds = restoredTwice.blocks
      .filter((block) => block.state === "live" && block.markdown === "Repeat")
      .map((block) => block.id);

    expect(repeatIds).toContain(repeatId);
    expect(new Set(repeatIds).size).toBe(2);
  });

  it("bounds tombstone recovery by revision age and total count", () => {
    let state = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Keep\nOld deletion",
    });
    state = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: state,
      markdown: "Keep",
      createId: idFactory(),
    });
    for (
      let revision = 0;
      revision < BLOCK_TOMBSTONE_REVISION_WINDOW;
      revision++
    ) {
      state = reconcileBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        previous: state,
        markdown: revision % 2 === 0 ? "Keep edited" : "Keep",
        createId: idFactory(),
      });
    }
    expect(
      state.blocks.filter((block) => block.state === "deleted"),
    ).toHaveLength(0);

    const many = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-many",
      propertyId: "content",
      markdown: Array.from(
        { length: MAX_BLOCK_TOMBSTONES_PER_FIELD + 1 },
        (_, index) => `Block ${index}`,
      ).join("\n"),
    });
    const allDeleted = reconcileBlocksFieldIdentity({
      documentId: "doc-many",
      propertyId: "content",
      previous: many,
      markdown: "",
      createId: idFactory(),
    });
    expect(
      allDeleted.blocks.filter((block) => block.state === "deleted"),
    ).toHaveLength(MAX_BLOCK_TOMBSTONES_PER_FIELD);
  });

  it("preserves honest IDs when siblings are reordered and edited together", () => {
    const initial = materializeLegacyBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      markdown: "Alpha paragraph\nBeta paragraph",
    });
    const [alphaId, betaId] = initial.blocks.map((block) => block.id);
    const reconciled = reconcileBlocksFieldIdentity({
      documentId: "doc-1",
      propertyId: "content",
      previous: initial,
      markdown: "Beta paragraph edited\nAlpha paragraph edited",
      createId: idFactory(),
    });

    expect(
      reconciled.blocks
        .filter((block) => block.state === "live")
        .map((block) => block.id),
    ).toEqual([betaId, alphaId]);
  });

  it("represents nested live NFM block kinds as an ordered parented graph", () => {
    const identity = legacyBlocksFieldIdentity({
      documentId: "doc-kinds",
      propertyId: "content",
      markdown: [
        "# Heading",
        "> Quote",
        "- List item",
        "\t- Nested item",
        "[ ] Task",
        "---",
        "```ts",
        "const stable = true",
        "```",
        '<callout icon="💡">',
        "\tInside",
        "</callout>",
      ].join("\n"),
    });
    const kinds = new Set(identity.blocks.map((block) => block.kind));

    expect(kinds).toEqual(
      expect.objectContaining(
        new Set([
          "heading",
          "blockquote",
          "bulletList",
          "listItem",
          "paragraph",
          "taskList",
          "taskItem",
          "horizontalRule",
          "codeBlock",
          "notionCallout",
        ]),
      ),
    );
    expect(identity.blocks.some((block) => block.parentId !== null)).toBe(true);
    expect(new Set(identity.blocks.map((block) => block.id)).size).toBe(
      identity.blocks.length,
    );
    expect(identity.fieldId).toBe(blocksFieldId("doc-kinds", "content"));
  });

  describe("one save that changes several blocks", () => {
    const apples =
      "Apples ripen in late summer and keep for months in a cool cellar.";
    const pears =
      "Pears bruise easily, so they are picked firm and ripened indoors.";
    const cherries =
      "Cherries come first, in early June, and last only a few weeks.";
    const plums = "Plums need a second tree nearby to set any fruit at all.";

    function save(previous: StoredBlocksFieldIdentity, markdown: string) {
      const next = reconcileBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        previous,
        markdown,
        createId: idFactory(),
      });
      return {
        live: next.blocks
          .filter((block) => block.state === "live")
          .map((block) => block.id),
        deleted: next.blocks
          .filter((block) => block.state === "deleted")
          .map((block) => block.id),
      };
    }

    function orchard() {
      const initial = materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        markdown: [apples, pears, cherries].join("\n"),
      });
      const [applesId, pearsId, cherriesId] = initial.blocks.map(
        (block) => block.id,
      );
      return { initial, applesId, pearsId, cherriesId };
    }

    it("keeps a paragraph's ID when it moves to the top with one word changed", () => {
      const { initial, applesId, pearsId, cherriesId } = orchard();
      const result = save(
        initial,
        [cherries.replace("a few", "two"), apples, pears].join("\n"),
      );

      expect(result.live).toEqual([cherriesId, applesId, pearsId]);
    });

    it("gives a new ID to a paragraph moved to the top and rewritten", () => {
      const { initial, applesId, pearsId, cherriesId } = orchard();
      const result = save(initial, [plums, apples, pears].join("\n"));

      expect(result.live.slice(1)).toEqual([applesId, pearsId]);
      expect([applesId, pearsId, cherriesId]).not.toContain(result.live[0]);
      expect(result.deleted).toContain(cherriesId);
    });

    it("never gives a deleted paragraph's ID to another paragraph rewritten in the same save", () => {
      const { initial, applesId, pearsId, cherriesId } = orchard();

      const firstDeleted = save(initial, [pears, plums].join("\n"));
      expect(firstDeleted.live).toEqual([pearsId, cherriesId]);
      expect(firstDeleted.deleted).toContain(applesId);

      const middleDeleted = save(initial, [apples, plums].join("\n"));
      expect(middleDeleted.live[0]).toBe(applesId);
      expect([pearsId, cherriesId]).not.toContain(middleDeleted.live[1]);
      expect(middleDeleted.deleted).toEqual(
        expect.arrayContaining([pearsId, cherriesId]),
      );
    });

    it("keeps one ID when one of two identical paragraphs is deleted", () => {
      const repeated = "See the note above.";
      const initial = materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        markdown: [apples, repeated, repeated].join("\n"),
      });
      const [applesId, firstRepeatId, secondRepeatId] = initial.blocks.map(
        (block) => block.id,
      );
      const result = save(initial, [apples, repeated].join("\n"));

      expect(result.live[0]).toBe(applesId);
      expect([firstRepeatId, secondRepeatId]).toContain(result.live[1]);
      expect(result.deleted).toEqual([
        result.live[1] === firstRepeatId ? secondRepeatId : firstRepeatId,
      ]);
    });

    it("gives a new ID to a paragraph turned into a heading", () => {
      const { initial, applesId, pearsId, cherriesId } = orchard();
      const result = save(
        initial,
        [`## ${apples}`, pears, cherries].join("\n"),
      );

      expect(result.live.slice(1)).toEqual([pearsId, cherriesId]);
      expect(result.live[0]).not.toBe(applesId);
      expect(result.deleted).toContain(applesId);
    });

    it("never moves a deleted top-level paragraph's ID into a list item", () => {
      const initial = materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        markdown: ["Intro paragraph", "- Buy milk"].join("\n"),
      });
      const [introId, ...listIds] = initial.blocks.map((block) => block.id);
      expect(initial.blocks.map((block) => block.kind)).toEqual([
        "paragraph",
        "bulletList",
        "listItem",
        "paragraph",
      ]);
      const result = save(initial, "- Call the plumber");

      expect(result.live).toEqual(listIds);
      expect(result.deleted).toEqual([introId]);
    });

    it("gives an empty page's paragraph ID to the first of several pasted paragraphs", () => {
      const initial = materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        markdown: "",
      });
      const [emptyId] = initial.blocks.map((block) => block.id);
      const result = save(initial, [apples, pears, cherries].join("\n"));

      expect(result.live[0]).toBe(emptyId);
      expect(new Set(result.live).size).toBe(3);
      expect(result.deleted).toEqual([]);
    });

    it("keeps the IDs of repeated empty paragraphs when a neighbor is edited", () => {
      const initial = materializeLegacyBlocksFieldIdentity({
        documentId: "doc-1",
        propertyId: "content",
        markdown: [apples, "<empty-block/>", "<empty-block/>", pears].join(
          "\n",
        ),
      });
      const ids = initial.blocks.map((block) => block.id);
      expect(ids).toHaveLength(4);
      const result = save(
        initial,
        [
          apples.replace("months", "weeks"),
          "<empty-block/>",
          "<empty-block/>",
          pears,
        ].join("\n"),
      );

      expect(result.live).toEqual(ids);
    });
  });
});

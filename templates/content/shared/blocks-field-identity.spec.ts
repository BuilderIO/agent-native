import { describe, expect, it } from "vitest";

import {
  blocksFieldId,
  exposeBlocksFieldIdentity,
  legacyBlocksFieldIdentity,
  materializeLegacyBlocksFieldIdentity,
  reconcileBlocksFieldIdentity,
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
});

import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import { prepareInitialCreationSave } from "./creation-save-baseline";

function document(args: Partial<Document> = {}): Document {
  return {
    id: "page-1",
    parentId: null,
    title: "",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
    createdAt: "2026-10-08T12:00:00.000Z",
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...args,
  };
}

describe("initial creation save baseline", () => {
  it("keeps the created revision as the base when the first read has a peer edit", () => {
    const created = document({ revision: "r1" });
    const observed = document({
      content: "Peer's paragraph",
      revision: "r2",
      updatedAt: "2026-10-08T12:00:02.000Z",
    });

    const prepared = prepareInitialCreationSave({
      pending: {
        content: "My paragraph",
        contentBase: { content: "", updatedAt: null },
        authoredContentIntent: {
          editGeneration: 1,
          baseContent: "",
          candidateContent: "My paragraph",
        },
        editGeneration: 1,
        titleBase: "",
      },
      creationBaseline: created,
      observedDocument: observed,
    });

    expect(prepared.contentBase).toEqual({
      content: "",
      updatedAt: created.updatedAt,
      revision: "r1",
    });
    expect(prepared.authoredContentIntent).toEqual({
      editGeneration: 1,
      baseRevision: "r1",
      baseContent: "",
      candidateContent: "My paragraph",
    });
    expect(prepared.contentAuthoredAfterRevision).toBe("r1");
    expect(prepared.titleBase).toBe("");
  });

  it("does not borrow the first read revision when the queued base differs from creation", () => {
    const created = document({ content: "Created content", revision: "r1" });
    const observed = document({ content: "Peer content", revision: "r2" });

    const prepared = prepareInitialCreationSave({
      pending: {
        content: "Local draft",
        contentBase: { content: "", updatedAt: null },
        authoredContentIntent: {
          editGeneration: 2,
          baseContent: "",
          candidateContent: "Local draft",
        },
        editGeneration: 2,
        titleBase: "",
      },
      creationBaseline: created,
      observedDocument: observed,
    });

    expect(prepared.contentBase).toEqual({ content: "", updatedAt: null });
    expect(prepared.authoredContentIntent).toEqual({
      editGeneration: 2,
      baseContent: "",
      candidateContent: "Local draft",
    });
    expect(prepared.contentAuthoredAfterRevision).toBeUndefined();
  });

  it("keeps the authored base separate when the save base already includes a peer edit", () => {
    const created = document({ revision: "r1" });
    const peerContent = "Peer content";
    const observed = document({
      content: peerContent,
      revision: "r2",
      updatedAt: "2026-10-08T12:00:02.000Z",
    });

    const prepared = prepareInitialCreationSave({
      pending: {
        content: "Local draft",
        contentBase: {
          content: peerContent,
          updatedAt: observed.updatedAt,
          revision: "r2",
        },
        authoredContentIntent: {
          editGeneration: 2,
          baseContent: "",
          candidateContent: "Local draft",
        },
        editGeneration: 2,
        titleBase: "",
      },
      creationBaseline: created,
      observedDocument: observed,
    });

    expect(prepared.contentBase).toEqual({
      content: peerContent,
      updatedAt: observed.updatedAt,
      revision: "r2",
    });
    expect(prepared.authoredContentIntent).toEqual({
      editGeneration: 2,
      baseRevision: "r1",
      baseContent: "",
      candidateContent: "Local draft",
    });
    expect(prepared.contentAuthoredAfterRevision).toBe("r1");
  });

  it("uses the observed body only when it already equals the queued draft", () => {
    const created = document({ revision: "r1" });
    const observed = document({ content: "Same content", revision: "r2" });

    const prepared = prepareInitialCreationSave({
      pending: {
        content: "Same content",
        contentBase: { content: "", updatedAt: null },
        editGeneration: 3,
        titleBase: "",
      },
      creationBaseline: created,
      observedDocument: observed,
    });

    expect(prepared.contentBase).toEqual({
      content: "Same content",
      updatedAt: observed.updatedAt,
      revision: "r2",
    });
    expect(prepared.authoredContentIntent).toBeUndefined();
  });
});

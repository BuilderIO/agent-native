import type { Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  isDatabaseChoicePending,
  isDocumentCreationPending,
  markDocumentCreationPending,
} from "./optimistic-document";

function document(): Document {
  return {
    id: "page-1",
    parentId: null,
    title: "",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-23T18:00:00.000Z",
    updatedAt: "2026-07-23T18:00:00.000Z",
  };
}

describe("optimistic document creation", () => {
  it("marks only the optimistic cache record as pending", () => {
    const optimistic = markDocumentCreationPending(document());

    expect(isDocumentCreationPending(optimistic)).toBe(true);
    expect(isDocumentCreationPending({ ...optimistic })).toBe(true);
    expect(isDocumentCreationPending(document())).toBe(false);
  });

  it("blocks database conversion until both page creation and conversion are idle", () => {
    const optimistic = markDocumentCreationPending(document());
    const persisted = document();

    expect(isDatabaseChoicePending(optimistic, false)).toBe(true);
    expect(isDatabaseChoicePending(persisted, true)).toBe(true);
    expect(isDatabaseChoicePending(persisted, false)).toBe(false);
  });
});

import type { ContentDatabaseItem, Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  builderBodyHydrationIsTerminalError,
  databaseItemBodyHydrationIsPending,
  documentBodyHydrationIsPending,
  isEffectivelyEmptyDocumentContent,
  previewBodyHydrationIsPending,
  previewBodyHydrationIsTerminalError,
  shouldIgnorePreviewEmptyNormalization,
} from "./body-hydration";

function documentWithHydration(
  status: "pending" | "hydrating" | "hydrated" | "error",
) {
  return {
    id: "row-page",
    parentId: "database-page",
    title: "Builder row",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-07-02T12:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
    databaseMembership: {
      databaseId: "database",
      databaseDocumentId: "database-page",
      databaseTitle: "Content calendar",
      position: 0,
      sourceId: "builder-source",
      bodyHydration: {
        status,
        attemptedAt: null,
        error: null,
        version: null,
      },
    },
  } satisfies Document;
}

describe("body hydration editing gates", () => {
  it("treats only in-progress Builder body hydration as not yet editable", () => {
    expect(
      documentBodyHydrationIsPending(documentWithHydration("pending")),
    ).toBe(true);
    expect(
      documentBodyHydrationIsPending(documentWithHydration("hydrating")),
    ).toBe(true);
    expect(documentBodyHydrationIsPending(documentWithHydration("error"))).toBe(
      false,
    );
    expect(
      documentBodyHydrationIsPending(documentWithHydration("hydrated")),
    ).toBe(false);
  });

  it("detects terminal Builder body hydration errors separately from pending gates", () => {
    expect(
      builderBodyHydrationIsTerminalError(
        documentWithHydration("error").databaseMembership?.bodyHydration,
      ),
    ).toBe(true);
    expect(
      builderBodyHydrationIsTerminalError(
        documentWithHydration("pending").databaseMembership?.bodyHydration,
      ),
    ).toBe(false);
  });

  it("uses row-level body hydration before membership fallback", () => {
    const item = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: documentWithHydration("hydrated"),
      properties: [],
      bodyHydration: {
        status: "pending",
        attemptedAt: null,
        error: null,
        version: null,
      },
    } satisfies ContentDatabaseItem;

    expect(databaseItemBodyHydrationIsPending(item)).toBe(true);
  });

  it("treats unknown source-row hydration as pending until the document response arrives", () => {
    const item = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: {
        ...documentWithHydration("hydrated"),
        databaseMembership: {
          databaseId: "database",
          databaseDocumentId: "database-page",
          databaseTitle: "Content calendar",
          position: 0,
          sourceId: "builder-source",
        },
      },
      properties: [],
    } satisfies ContentDatabaseItem;

    expect(databaseItemBodyHydrationIsPending(item)).toBe(true);
    expect(previewBodyHydrationIsPending({ item, document: null })).toBe(true);
  });

  it("uses fresh document-level hydration for preview gating", () => {
    const item = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: documentWithHydration("hydrated"),
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: null,
        error: null,
        version: "v1",
      },
    } satisfies ContentDatabaseItem;

    expect(
      previewBodyHydrationIsPending({
        item,
        document: documentWithHydration("hydrating"),
      }),
    ).toBe(true);
  });

  it("uses fresh document-level hydration for terminal preview errors", () => {
    const item = {
      id: "item-a",
      databaseId: "database",
      position: 0,
      document: documentWithHydration("hydrated"),
      properties: [],
      bodyHydration: {
        status: "hydrated",
        attemptedAt: null,
        error: null,
        version: "v1",
      },
    } satisfies ContentDatabaseItem;

    expect(
      previewBodyHydrationIsTerminalError({
        item,
        document: documentWithHydration("error"),
      }),
    ).toBe(true);
  });

  it("treats the editor empty block sentinel as empty content", () => {
    expect(isEffectivelyEmptyDocumentContent("")).toBe(true);
    expect(isEffectivelyEmptyDocumentContent(" <empty-block/> ")).toBe(true);
    expect(isEffectivelyEmptyDocumentContent("Hydrated body")).toBe(false);
  });

  it("ignores untouched empty preview normalization before it can dirty-save", () => {
    expect(
      shouldIgnorePreviewEmptyNormalization({
        currentContent: "",
        nextContent: "<empty-block/>",
      }),
    ).toBe(true);
    expect(
      shouldIgnorePreviewEmptyNormalization({
        currentContent: "Hydrated body",
        nextContent: "<empty-block/>",
      }),
    ).toBe(false);
  });
});

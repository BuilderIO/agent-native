import type { ContentDatabaseItem, Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  builderBodyHydrationDisplayHydratedCount,
  builderBodyHydrationIsTerminalError,
  databaseItemBodyHydrationIsPending,
  documentBodyHydrationIsPending,
  isEffectivelyEmptyDocumentContent,
  previewBodyHydrationIsPending,
  previewBodyHydrationIsTerminalError,
  previewDraftConflictsWithHydratedBody,
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
      documentBodyHydrationIsPending({
        ...documentWithHydration("hydrated"),
        content: "Hydrated body",
      }),
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

  it("does not let high-water progress make active body sync look complete", () => {
    expect(
      builderBodyHydrationDisplayHydratedCount({
        summary: {
          pending: 1,
          hydrating: 0,
          hydrated: 496,
          error: 0,
          total: 497,
        },
        highWaterCount: 497,
      }),
    ).toBe(496);
  });

  it("does not count failed Builder bodies as hydrated in retry states", () => {
    expect(
      builderBodyHydrationDisplayHydratedCount({
        summary: {
          pending: 0,
          hydrating: 0,
          hydrated: 496,
          error: 1,
          total: 497,
        },
        highWaterCount: 497,
      }),
    ).toBe(496);
  });

  it("does not count actively hydrating Builder bodies as complete", () => {
    expect(
      builderBodyHydrationDisplayHydratedCount({
        summary: {
          pending: 0,
          hydrating: 1,
          hydrated: 496,
          error: 0,
          total: 497,
        },
        highWaterCount: 497,
      }),
    ).toBe(496);
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

  it("treats source-backed empty documents with no body hydration as pending", () => {
    const document = {
      ...documentWithHydration("hydrated"),
      databaseMembership: {
        databaseId: "database",
        databaseDocumentId: "database-page",
        databaseTitle: "Content calendar",
        position: 0,
        sourceId: "builder-source",
      },
    } satisfies Document;

    expect(documentBodyHydrationIsPending(document)).toBe(true);
  });

  it("treats source-backed empty documents marked hydrated without a version as pending", () => {
    expect(
      documentBodyHydrationIsPending(documentWithHydration("hydrated")),
    ).toBe(true);
  });

  it("keeps non-empty source-backed documents editable even when the old body version is missing", () => {
    expect(
      documentBodyHydrationIsPending({
        ...documentWithHydration("hydrated"),
        content: "The Builder body is here.",
      }),
    ).toBe(false);
  });

  it("does not hide source-backed body hydration errors behind a pending gate", () => {
    expect(documentBodyHydrationIsPending(documentWithHydration("error"))).toBe(
      false,
    );
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

  it("keeps a non-empty draft recoverable when Builder hydrates a body over its empty baseline", () => {
    expect(
      previewDraftConflictsWithHydratedBody({
        loadedContent: "",
        loadedUpdatedAt: "v1",
        loadedContentWasEmpty: true,
        pendingContent: "My local draft",
        hydratedContent: "Fresh Builder body",
        hydratedUpdatedAt: "v2",
      }),
    ).toBe(true);
    expect(
      previewDraftConflictsWithHydratedBody({
        loadedContent: "Original Builder body",
        loadedUpdatedAt: "v1",
        loadedContentWasEmpty: false,
        pendingContent: "My local draft",
        hydratedContent: "Fresh Builder body",
        hydratedUpdatedAt: "v2",
      }),
    ).toBe(true);
    expect(
      previewDraftConflictsWithHydratedBody({
        loadedContent: "Original Builder body",
        loadedUpdatedAt: "v1",
        loadedContentWasEmpty: false,
        pendingContent: "My local draft",
        hydratedContent: "Original Builder body",
        hydratedUpdatedAt: "v1",
      }),
    ).toBe(false);
    expect(
      previewDraftConflictsWithHydratedBody({
        loadedContent: "",
        loadedUpdatedAt: "v1",
        loadedContentWasEmpty: true,
        pendingContent: "<empty-block/>",
        hydratedContent: "Fresh Builder body",
        hydratedUpdatedAt: "v2",
      }),
    ).toBe(false);
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

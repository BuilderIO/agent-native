import type { ContentDatabaseItem, Document } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  databaseItemBodyHydrationIsPending,
  documentBodyHydrationIsPending,
} from "./body-hydration";

function documentWithHydration(status: "pending" | "hydrating" | "hydrated") {
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
  it("treats pending and hydrating Builder bodies as not yet editable", () => {
    expect(
      documentBodyHydrationIsPending(documentWithHydration("pending")),
    ).toBe(true);
    expect(
      documentBodyHydrationIsPending(documentWithHydration("hydrating")),
    ).toBe(true);
    expect(
      documentBodyHydrationIsPending(documentWithHydration("hydrated")),
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
});

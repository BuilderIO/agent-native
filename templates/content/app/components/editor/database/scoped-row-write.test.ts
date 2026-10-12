import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseItem,
  ContentDatabaseMutationTarget,
} from "../../../../shared/api.js";
import {
  documentDatabaseWidgetEditProps,
  scopedDatabaseRowTitleUpdateRequest,
} from "./scoped-row-write";

const target: ContentDatabaseMutationTarget = {
  authorityScope: { kind: "personal", id: "space-1" },
  spaceId: "space-1",
  databaseId: "database-1",
  databaseDocumentId: "database-page-1",
};

const item: ContentDatabaseItem = {
  id: "membership-1",
  databaseId: "database-1",
  document: {
    id: "row-page-1",
    parentId: null,
    title: "Old title",
    content: "",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    createdAt: "2026-10-08T00:00:00.000Z",
    updatedAt: "2026-10-08T00:00:00.000Z",
  },
  position: 0,
  properties: [],
  rowRevision: "row-revision-1",
};

describe("scoped database row title updates", () => {
  it("keeps widget document controls read-only and requires the row grant", () => {
    expect(
      documentDatabaseWidgetEditProps(
        {
          mcpDirectoryWidgetReadOnly: true,
          mcpDirectoryWidgetCanEditDatabaseRows: true,
        },
        true,
        true,
      ),
    ).toEqual({ canEdit: false, canEditRows: true });
    expect(
      documentDatabaseWidgetEditProps(
        {
          mcpDirectoryWidgetReadOnly: true,
          mcpDirectoryWidgetCanEditDatabaseRows: undefined,
        },
        true,
        true,
      ),
    ).toEqual({ canEdit: false, canEditRows: false });
    expect(
      documentDatabaseWidgetEditProps(
        {
          mcpDirectoryWidgetReadOnly: true,
          mcpDirectoryWidgetCanEditDatabaseRows: true,
        },
        true,
        false,
      ),
    ).toEqual({ canEdit: false, canEditRows: false });
    expect(
      documentDatabaseWidgetEditProps(
        { mcpDirectoryWidgetReadOnly: undefined },
        true,
      ),
    ).toEqual({ canEdit: true, canEditRows: false });
  });

  it("uses the exact membership, page, schema, and row revisions", () => {
    expect(
      scopedDatabaseRowTitleUpdateRequest({
        item,
        target,
        expectedSchemaRevision: "schema-revision-1",
        idempotencyKey: "request-1",
        title: "  New title  ",
      }),
    ).toEqual({
      target,
      expectedSchemaRevision: "schema-revision-1",
      idempotencyKey: "request-1",
      itemId: "membership-1",
      documentId: "row-page-1",
      expectedRowRevision: "row-revision-1",
      title: "New title",
    });
  });

  it("fails closed when the read has no row revision", () => {
    expect(
      scopedDatabaseRowTitleUpdateRequest({
        item: { ...item, rowRevision: undefined },
        target,
        expectedSchemaRevision: "schema-revision-1",
        idempotencyKey: "request-2",
        title: "New title",
      }),
    ).toBeNull();
  });

  it("rejects a row from another collection and blank titles", () => {
    expect(
      scopedDatabaseRowTitleUpdateRequest({
        item,
        target: { ...target, databaseId: "other-database" },
        expectedSchemaRevision: "schema-revision-1",
        idempotencyKey: "request-3",
        title: "New title",
      }),
    ).toBeNull();
    expect(
      scopedDatabaseRowTitleUpdateRequest({
        item,
        target,
        expectedSchemaRevision: "schema-revision-1",
        idempotencyKey: "request-4",
        title: "   ",
      }),
    ).toBeNull();
  });
});

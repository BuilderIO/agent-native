import type { ContentDatabaseResponse } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  contentDatabaseViewSaveRequest,
  createDatabaseView,
  defaultDatabaseViewConfig,
  databaseViewConfigWithSavedQueryState,
  rollbackFailedDatabaseViewSave,
} from "./DatabaseView";

function config(wrapped: boolean, frozen: string | null = null) {
  const base = defaultDatabaseViewConfig();
  return {
    ...base,
    views: [
      createDatabaseView("Table", "default", {
        columnWrapOverrides: { name: wrapped },
        frozenThroughColumnId: frozen,
      }),
    ],
  };
}

describe("failed table presentation saves", () => {
  it("restores the latest committed layout after a later save fails", () => {
    const committed = config(true);
    const failed = config(true, "name");
    expect(
      rollbackFailedDatabaseViewSave({
        databaseId: "qa",
        current: failed,
        saved: committed,
        failed,
        personalQueryDirty: false,
      }),
    ).toEqual(committed);
  });

  it("does not overwrite a newer local arrangement with an older failure", () => {
    const saved = config(false);
    const failed = config(true);
    const newer = config(true, "name");
    expect(
      rollbackFailedDatabaseViewSave({
        databaseId: "qa",
        current: newer,
        saved,
        failed,
        personalQueryDirty: false,
      }),
    ).toBe(newer);
  });

  it("keeps personal query exploration when shared presentation rolls back", () => {
    const saved = config(false);
    const current = config(true, "name");
    current.views[0].sorts = [
      { key: "name", label: "Name", direction: "desc" },
    ];
    const failed = databaseViewConfigWithSavedQueryState(current, saved);
    const result = rollbackFailedDatabaseViewSave({
      databaseId: "qa",
      current,
      saved,
      failed,
      personalQueryDirty: true,
    });
    expect(result.views[0].columnWrapOverrides).toEqual({ name: false });
    expect(result.views[0].frozenThroughColumnId).toBeNull();
    expect(result.views[0].sorts).toEqual(current.views[0].sorts);
  });
});

function databaseResponse({
  id = "qa",
  spaceId = "space-1",
  systemRole = null,
}: {
  id?: string;
  spaceId?: string | null;
  systemRole?: string | null;
} = {}): ContentDatabaseResponse {
  return {
    database: {
      id,
      documentId: `${id}-page`,
      spaceId,
      systemRole,
      title: "QA",
      viewConfig: defaultDatabaseViewConfig(),
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
    },
    properties: [],
    items: [],
    source: null,
  };
}

const guardedRevision = {
  databaseId: "qa",
  target: {
    spaceId: "space-1",
    databaseId: "qa",
    databaseDocumentId: "qa-page",
  },
  schemaRevision: "schema-1",
  configurationRevision: "configuration-1",
};

describe("database view save compatibility", () => {
  it.each([
    { systemRole: "files", spaceId: "space-1" },
    { systemRole: null, spaceId: null },
  ])(
    "uses the legacy action contract for an explicitly unsupported database class",
    ({ systemRole, spaceId }) => {
      const viewConfig = defaultDatabaseViewConfig();
      viewConfig.views[0] = {
        ...viewConfig.views[0],
        type: "calendar",
        datePropertyId: "publish-date",
        endDatePropertyId: "publish-end",
      };

      expect(
        contentDatabaseViewSaveRequest({
          data: databaseResponse({ systemRole, spaceId }),
          databaseId: "qa",
          revision: null,
          idempotencyKey: "intent-1",
          viewConfig,
        }),
      ).toEqual({ databaseId: "qa", viewConfig });
    },
  );

  it("keeps ordinary scoped databases on the revision-guarded contract", () => {
    const viewConfig = defaultDatabaseViewConfig();
    expect(
      contentDatabaseViewSaveRequest({
        data: databaseResponse(),
        databaseId: "qa",
        revision: guardedRevision,
        idempotencyKey: "intent-1",
        viewConfig,
      }),
    ).toEqual({
      operation: "replace",
      target: guardedRevision.target,
      expectedSchemaRevision: "schema-1",
      expectedConfigurationRevision: "configuration-1",
      idempotencyKey: "intent-1",
      viewConfig,
    });
  });

  it("refuses an ordinary scoped save when its guarded contract is missing", () => {
    expect(() =>
      contentDatabaseViewSaveRequest({
        data: databaseResponse(),
        databaseId: "qa",
        revision: null,
        idempotencyKey: "intent-1",
        viewConfig: defaultDatabaseViewConfig(),
      }),
    ).toThrow("Database view save contract is unavailable");
  });

  it("refuses a queued save when the loaded database has changed", () => {
    expect(() =>
      contentDatabaseViewSaveRequest({
        data: databaseResponse({ id: "new-database", spaceId: null }),
        databaseId: "old-database",
        revision: null,
        idempotencyKey: "intent-1",
        viewConfig: defaultDatabaseViewConfig(),
      }),
    ).toThrow("Database view save context is unavailable");
  });
});

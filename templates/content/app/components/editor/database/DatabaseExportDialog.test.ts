import { describe, expect, it } from "vitest";

import {
  databaseCsvRequest,
  defaultDatabaseCsvPropertyIds,
  shouldInitializeDatabaseExportDialog,
  type DatabaseExportContext,
} from "./DatabaseExportDialog";

const context: DatabaseExportContext = {
  viewId: "view-active",
  viewName: "Active view",
  query: {
    search: "roadmap",
    filters: [
      {
        key: "status",
        label: "Status",
        operator: "equals",
        value: "published",
      },
    ],
    sorts: [{ key: "date", label: "Date", direction: "desc" }],
    filterMode: "and",
  },
  properties: [
    { id: "visible-text", name: "Visible text", type: "text", visible: true },
    {
      id: "hidden-number",
      name: "Hidden number",
      type: "number",
      visible: false,
    },
    { id: "body", name: "Body", type: "blocks", visible: true },
  ],
};

describe("DatabaseExportDialog", () => {
  it("defaults to visible scalar columns, excluding blocks", () => {
    expect(defaultDatabaseCsvPropertyIds(context.properties)).toEqual([
      "visible-text",
    ]);
  });

  it("initializes selections only when the dialog opens", () => {
    expect(shouldInitializeDatabaseExportDialog(false, true)).toBe(true);
    expect(shouldInitializeDatabaseExportDialog(true, true)).toBe(false);
    expect(shouldInitializeDatabaseExportDialog(true, false)).toBe(false);
    expect(shouldInitializeDatabaseExportDialog(false, false)).toBe(false);
  });

  it("sends the exact all-members CSV payload", () => {
    expect(
      databaseCsvRequest({
        id: "database-page",
        context,
        scope: "all_members",
        propertyIds: ["visible-text", "body"],
      }),
    ).toEqual({
      id: "database-page",
      format: "csv",
      collection: {
        scope: { kind: "all_members" },
        propertyIds: ["visible-text", "body"],
      },
    });
  });

  it("retains the complete active-view query for a current-view export", () => {
    expect(
      databaseCsvRequest({
        id: "database-page",
        context,
        scope: "current_view",
        propertyIds: ["visible-text"],
      }),
    ).toEqual({
      id: "database-page",
      format: "csv",
      collection: {
        scope: {
          kind: "current_view",
          viewId: "view-active",
          query: context.query,
        },
        propertyIds: ["visible-text"],
      },
    });
  });
});

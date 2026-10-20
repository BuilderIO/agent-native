import { describe, expect, it } from "vitest";

import {
  additionalDatabaseExportBlockProperties,
  buildStoreOnlyZip,
  databaseExportRequest,
  defaultDatabaseExportPropertyIds,
  defaultDatabaseExportSelections,
  shouldInitializeDatabaseExportDialog,
  updateDatabaseExportSelection,
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
    {
      id: "body",
      name: "Body",
      type: "blocks",
      visible: true,
      primaryBody: true,
    },
    { id: "notes", name: "Notes", type: "blocks", visible: true },
  ],
};

describe("DatabaseExportDialog", () => {
  it("defaults to visible scalar properties, excluding Blocks", () => {
    expect(defaultDatabaseExportPropertyIds(context.properties)).toEqual([
      "visible-text",
    ]);
  });

  it("offers additional Blocks fields without duplicating the primary body", () => {
    expect(additionalDatabaseExportBlockProperties(context.properties)).toEqual(
      [expect.objectContaining({ id: "notes" })],
    );
  });

  it("defaults CSV bodies off and readable-format primary bodies on", () => {
    expect(defaultDatabaseExportSelections(context.properties)).toEqual({
      csv: {
        propertyIds: ["visible-text"],
        includePrimaryBody: false,
        blockPropertyIds: [],
      },
      markdown: {
        propertyIds: ["visible-text"],
        includePrimaryBody: true,
        blockPropertyIds: [],
      },
      html: {
        propertyIds: ["visible-text"],
        includePrimaryBody: true,
        blockPropertyIds: [],
      },
      pdf: {
        propertyIds: ["visible-text"],
        includePrimaryBody: true,
        blockPropertyIds: [],
      },
    });
  });

  it("initializes selections only when the dialog opens", () => {
    expect(shouldInitializeDatabaseExportDialog(false, true)).toBe(true);
    expect(shouldInitializeDatabaseExportDialog(true, true)).toBe(false);
    expect(shouldInitializeDatabaseExportDialog(true, false)).toBe(false);
    expect(shouldInitializeDatabaseExportDialog(false, false)).toBe(false);
  });

  it("retains each format's changed selections while the dialog stays open", () => {
    const defaults = defaultDatabaseExportSelections(context.properties);
    const withCsvBlocks = updateDatabaseExportSelection(defaults, "csv", {
      blockPropertyIds: ["body"],
    });
    const withMarkdownScalarChange = updateDatabaseExportSelection(
      withCsvBlocks,
      "markdown",
      { propertyIds: [] },
    );

    expect(withMarkdownScalarChange.csv.blockPropertyIds).toEqual(["body"]);
    expect(withMarkdownScalarChange.markdown.propertyIds).toEqual([]);
    expect(withMarkdownScalarChange.html).toEqual(defaults.html);
  });

  it("sends the exact all-members collection payload", () => {
    expect(
      databaseExportRequest({
        id: "database-page",
        format: "html",
        context,
        scope: "all_members",
        selection: {
          propertyIds: ["visible-text"],
          includePrimaryBody: true,
          blockPropertyIds: ["body"],
        },
      }),
    ).toEqual({
      id: "database-page",
      format: "html",
      collection: {
        scope: { kind: "all_members" },
        propertyIds: ["visible-text"],
        includePrimaryBody: true,
        blockPropertyIds: ["body"],
      },
    });
  });

  it("retains the complete active-view query for a current-view export", () => {
    expect(
      databaseExportRequest({
        id: "database-page",
        format: "csv",
        context,
        scope: "current_view",
        selection: {
          propertyIds: ["visible-text"],
          includePrimaryBody: false,
          blockPropertyIds: [],
        },
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
        includePrimaryBody: false,
        blockPropertyIds: [],
      },
    });
  });

  it("builds a real store-only ZIP for Markdown package files", () => {
    const zip = buildStoreOnlyZip([
      { path: "index.md", content: "# Export" },
      { path: "records/one.md", content: "# One" },
    ]);
    const view = new DataView(zip.buffer);
    const decoder = new TextDecoder();
    const entries: Record<string, string> = {};
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const contentLength = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const contentStart = nameStart + nameLength + extraLength;
      const name = decoder.decode(zip.subarray(nameStart, contentStart));
      entries[name] = decoder.decode(
        zip.subarray(contentStart, contentStart + contentLength),
      );
      offset = contentStart + contentLength;
    }

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(entries).toEqual({
      "index.md": "# Export",
      "records/one.md": "# One",
    });
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
  });
});

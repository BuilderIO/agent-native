import { describe, expect, it } from "vitest";

import { directoryWidgetEditability } from "./directory-widget-editability.js";

describe("directoryWidgetEditability", () => {
  it("keeps a read-only document ticket non-editable", () => {
    expect(
      directoryWidgetEditability({
        canEdit: true,
        mcpDirectoryWidgetReadOnly: true,
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
  });

  it("enables only body editing for a document write ticket", () => {
    expect(
      directoryWidgetEditability({
        canEdit: true,
        mcpDirectoryWidgetReadOnly: true,
        mcpDirectoryWidgetCanEditDocument: true,
      }),
    ).toEqual({ canEditDocument: true, canEditDatabaseRows: false });
  });

  it("enables row editing without enabling the database page body", () => {
    expect(
      directoryWidgetEditability({
        canEdit: true,
        mcpDirectoryWidgetReadOnly: true,
        mcpDirectoryWidgetCanEditDatabaseRows: true,
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: true });
  });

  it("does not override the workspace access role", () => {
    expect(
      directoryWidgetEditability({
        canEdit: false,
        mcpDirectoryWidgetReadOnly: true,
        mcpDirectoryWidgetCanEditDocument: true,
        mcpDirectoryWidgetCanEditDatabaseRows: true,
      }),
    ).toEqual({ canEditDocument: false, canEditDatabaseRows: false });
  });
});

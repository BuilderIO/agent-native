import { describe, expect, it } from "vitest";

import {
  createDatabaseView,
  duplicateDatabaseView,
  normalizeClientDatabaseViewConfig,
} from "./view-config";

describe("database form view config", () => {
  it("normalizes form questions, removes duplicate keys, and preserves order", () => {
    const config = normalizeClientDatabaseViewConfig({
      activeViewId: "form",
      views: [
        {
          id: "form",
          name: "Request design",
          type: "form",
          sorts: [],
          filters: [],
          columnWidths: {},
          formQuestions: [
            { key: "name", enabled: true, required: true },
            { key: "priority", enabled: true, required: true },
            { key: "name", enabled: false, required: false },
          ],
        },
      ],
      sorts: [],
      filters: [],
      columnWidths: {},
    });

    expect(config.views[0]).toMatchObject({
      type: "form",
      formQuestions: [
        { key: "name", enabled: true, required: true },
        { key: "priority", enabled: true, required: true },
      ],
    });
  });

  it("keeps legacy views compatible and gives new form views safe defaults", () => {
    const legacy = normalizeClientDatabaseViewConfig({
      activeViewId: "legacy",
      views: [
        {
          id: "legacy",
          name: "Legacy table",
          type: "table",
          sorts: [],
          filters: [],
          columnWidths: {},
        },
      ],
      sorts: [],
      filters: [],
      columnWidths: {},
    });
    expect(legacy.views[0].formQuestions).toEqual([]);

    const form = createDatabaseView("Request", "form", {}, "form");
    expect(form).toMatchObject({ type: "form", formQuestions: [] });
  });

  it("duplicates a form view with its question order and required flags", () => {
    const form = createDatabaseView(
      "Request",
      "form",
      {
        formQuestions: [
          { key: "name", enabled: true, required: true },
          { key: "deadline", enabled: true, required: false },
        ],
      },
      "form",
    );
    const duplicated = duplicateDatabaseView(
      {
        activeViewId: form.id,
        views: [form],
        sorts: [],
        filters: [],
        columnWidths: {},
      },
      form.id,
    );
    expect(duplicated.views).toHaveLength(2);
    expect(duplicated.views[1].formQuestions).toEqual(form.formQuestions);
  });
});

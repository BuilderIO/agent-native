import { describe, expect, it } from "vitest";

import {
  COLUMN_HEADERS,
  DEFAULT_HIDDEN_COLUMNS,
  REQUIRED_COLUMNS,
} from "./columnDefinitions";
import {
  EMPTY_FILTERS,
  VISIBLE_COLUMNS,
  filterProjects,
  type ProjectListItem,
} from "./projectList";

function project(id: string, creatorEmail: string): ProjectListItem {
  return {
    id,
    title: id,
    ownerEmail: creatorEmail,
    creatorEmail,
  } as ProjectListItem;
}

describe("Projects original parity", () => {
  it("shows App last published, Your access and Shared with by default", () => {
    const shown = VISIBLE_COLUMNS.map((id) => COLUMN_HEADERS[id]);
    expect(shown).toEqual(
      expect.arrayContaining([
        "App last published",
        "Your access",
        "Shared with",
      ]),
    );
    for (const id of ["dateLastPublished", "myAccess", "sharedWith"] as const) {
      expect(DEFAULT_HIDDEN_COLUMNS).not.toContain(id);
      expect(REQUIRED_COLUMNS).toContain(id);
    }
  });

  it("Created by you keeps only projects the current user created", () => {
    const rows = [project("mine", "me@example.test"), project("x", "o@x.test")];
    const result = filterProjects(
      rows,
      { ...EMPTY_FILTERS, createdByMe: true },
      "ME@example.test",
    );
    expect(result.map((row) => row.id)).toEqual(["mine"]);
  });
});

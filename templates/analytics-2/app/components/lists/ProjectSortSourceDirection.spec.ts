import { describe, expect, it } from "vitest";

import { readProjectListSortQuery } from "./project-list-sort-query";

describe("project sort source direction", () => {
  it("retains the source default direction for a title URL without a suffix", () => {
    expect(readProjectListSortQuery("project_name", null)).toEqual({
      sort: "title",
      direction: "desc",
    });
  });

  it("keeps the direction from the shared link ahead of a legacy direction", () => {
    expect(readProjectListSortQuery("project_name:desc", "ASC")).toEqual({
      sort: "title",
      direction: "desc",
    });
  });

  it("keeps legacy title URLs on their existing unspecified direction", () => {
    expect(readProjectListSortQuery("name", null)).toEqual({
      sort: "title",
      direction: undefined,
    });
  });
});

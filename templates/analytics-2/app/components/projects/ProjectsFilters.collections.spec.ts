import { describe, expect, it } from "vitest";

import type { Project } from "@/lib/model/contracts";

import { EMPTY_FILTERS, filterProjects } from "./projectList";

const project = (over: Partial<Project>): Project => ({
  id: "prj_1",
  ownerEmail: "qa@example.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("project collection filter", () => {
  it("keeps only projects filed into a selected collection", () => {
    const rows = [project({ id: "a" }), project({ id: "b" })];
    const collections = new Map([
      ["a", [{ id: "col_revenue" }]],
      ["b", [{ id: "col_ops" }]],
    ]);
    expect(
      filterProjects(
        rows,
        { ...EMPTY_FILTERS, collectionIds: ["col_revenue"] },
        "qa@example.test",
        "",
        new Map(),
        collections,
      ).map((row) => row.id),
    ).toEqual(["a"]);
  });

  it("does not filter when no collection is selected", () => {
    const rows = [project({ id: "a" }), project({ id: "b" })];
    expect(filterProjects(rows, EMPTY_FILTERS, "qa@example.test")).toHaveLength(
      2,
    );
  });
});

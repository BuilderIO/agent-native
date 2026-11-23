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

describe("project status and category filters", () => {
  it("keeps only projects carrying a selected status", () => {
    const rows = [
      project({ id: "a", statusId: "sts_done" }),
      project({ id: "b", statusId: null }),
      project({ id: "c", statusId: "sts_dev" }),
    ];
    expect(
      filterProjects(
        rows,
        { ...EMPTY_FILTERS, statusIds: ["sts_done"] },
        "qa@example.test",
      ).map((row) => row.id),
    ).toEqual(["a"]);
  });

  it("matches a project that carries any selected category", () => {
    const rows = [project({ id: "a" }), project({ id: "b" })];
    const categories = new Map([
      ["a", [{ id: "cat_dive" }]],
      ["b", [{ id: "cat_dash" }]],
    ]);
    expect(
      filterProjects(
        rows,
        { ...EMPTY_FILTERS, categoryIds: ["cat_dash"] },
        "qa@example.test",
        "",
        categories,
      ).map((row) => row.id),
    ).toEqual(["b"]);
  });

  it("does not filter when the new selections are empty or absent", () => {
    const rows = [project({ id: "a" }), project({ id: "b" })];
    expect(
      filterProjects(
        rows,
        { favoritedOnly: false, createdByMe: false },
        "qa@example.test",
      ),
    ).toHaveLength(2);
  });
});

it("report 1794901508.878089 filters by creator after ownership changes", () => {
  const rows = [
    {
      ...project({ id: "created", ownerEmail: "other@example.test" }),
      creatorEmail: "QA@example.test",
    },
    { ...project({ id: "owned" }), creatorEmail: "other@example.test" },
    { ...project({ id: "unknown" }), creatorEmail: null },
  ];
  expect(
    filterProjects(
      rows,
      { ...EMPTY_FILTERS, createdByMe: true },
      "qa@example.test",
    ).map((row) => row.id),
  ).toEqual(["created"]);
});

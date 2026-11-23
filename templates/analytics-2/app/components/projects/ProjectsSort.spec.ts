import { describe, expect, it } from "vitest";

import type { Project } from "@/lib/model/contracts";

import { sortProjects } from "./projectList";

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

const statusNames = new Map([
  ["sts_dev", "In development"],
  ["sts_done", "Completed"],
]);

describe("sorting by status and categories", () => {
  it("orders by the status name the table shows", () => {
    const rows = [
      project({ id: "a", statusId: "sts_done" }),
      project({ id: "b", statusId: "sts_dev" }),
      project({ id: "c", statusId: null }),
    ];
    expect(
      sortProjects(
        rows,
        { option: "status", direction: "ASC" },
        { statusNames },
      ).map((row) => row.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("orders by the applied category names", () => {
    const rows = [project({ id: "a" }), project({ id: "b" })];
    const categoriesByProject = new Map([
      ["a", [{ name: "Dashboard" }]],
      ["b", [{ name: "Deep dive" }]],
    ]);
    expect(
      sortProjects(
        rows,
        { option: "categories", direction: "ASC" },
        { categoriesByProject },
      ).map((row) => row.id),
    ).toEqual(["a", "b"]);
  });

  it("keeps the incoming order for an option this build cannot sort", () => {
    const rows = [project({ id: "b" }), project({ id: "a" })];
    expect(
      sortProjects(rows, { option: "myAccess", direction: "ASC" }).map(
        (row) => row.id,
      ),
    ).toEqual(["b", "a"]);
  });
});

it("sorts by recorded app views with unpublished projects last", () => {
  const rows = [
    { ...project({ id: "a" }), appViews: 2 },
    { ...project({ id: "b" }), appViews: null },
    { ...project({ id: "c" }), appViews: 5 },
    { ...project({ id: "d" }), appViews: 0 },
  ];
  expect(
    sortProjects(rows, { option: "appViews", direction: "DESC" }).map(
      (row) => row.id,
    ),
  ).toEqual(["c", "a", "d", "b"]);
});

it("report 1794901508.878089 sorts creator and publication metadata", () => {
  const rows = [
    {
      ...project({ id: "a" }),
      creatorEmail: "z@example.test",
      lastPublishedAt: "2026-11-02T00:00:00.000Z",
    },
    {
      ...project({ id: "b" }),
      creatorEmail: "a@example.test",
      lastPublishedAt: "2026-11-03T00:00:00.000Z",
    },
  ];
  expect(
    sortProjects(rows, { option: "creator", direction: "ASC" }).map(
      (row) => row.id,
    ),
  ).toEqual(["b", "a"]);
  expect(
    sortProjects(rows, { option: "appLastPublished", direction: "DESC" }).map(
      (row) => row.id,
    ),
  ).toEqual(["b", "a"]);
});

it("report 1794901508.878089 sorts app views by selected duration window and member display names", () => {
  const rows = [
    {
      ...project({ id: "evergreen", ownerEmail: "z@example.test" }),
      ownerName: "Ada Lovelace",
      creatorEmail: "z@example.test",
      creatorName: "Ada Lovelace",
      appViews: 100,
      appViewsByDuration: {
        ALL_TIME: 100,
        ONE_WEEK: 1,
        TWO_WEEKS: 3,
        ONE_MONTH: 10,
      },
    },
    {
      ...project({ id: "trending", ownerEmail: "a@example.test" }),
      ownerName: "Grace Hopper",
      creatorEmail: "a@example.test",
      creatorName: "Grace Hopper",
      appViews: 12,
      appViewsByDuration: {
        ALL_TIME: 12,
        ONE_WEEK: 9,
        TWO_WEEKS: 11,
        ONE_MONTH: 12,
      },
    },
    {
      ...project({ id: "draft", ownerEmail: "m@example.test" }),
      appViews: null,
      appViewsByDuration: null,
    },
  ];
  expect(
    sortProjects(
      rows,
      { option: "appViews", direction: "DESC" },
      { viewCountDuration: "ALL_TIME" },
    ).map((row) => row.id),
  ).toEqual(["evergreen", "trending", "draft"]);
  expect(
    sortProjects(
      rows,
      { option: "appViews", direction: "DESC" },
      { viewCountDuration: "ONE_WEEK" },
    ).map((row) => row.id),
  ).toEqual(["trending", "evergreen", "draft"]);
  expect(
    sortProjects(rows, { option: "owner", direction: "ASC" }).map(
      (row) => row.id,
    ),
  ).toEqual(["evergreen", "trending", "draft"]);
  expect(
    sortProjects(rows, { option: "creator", direction: "ASC" }).map(
      (row) => row.id,
    ),
  ).toEqual(["draft", "evergreen", "trending"]);
});

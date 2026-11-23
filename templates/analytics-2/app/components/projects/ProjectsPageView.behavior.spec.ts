import { describe, expect, it } from "vitest";

import { resolveRoutePage } from "@/components/workspace/pages";

import { projectsListViewFor } from "./ProjectsPage";

/**
 * sprint-analytics-2#496: the rebuilt sidebar draws Archive and Trash, but the Trash
 * route had no page (an empty frame) and Archive had no route at all. The project
 * list action already carries the three views, so the page takes its view from the
 * route instead of always asking for the active list.
 */
describe("the project list view for a route", () => {
  it("asks for the trash view on the trash route", () => {
    expect(projectsListViewFor("trash")).toBe("trash");
  });

  it("asks for the archive view on an archive route", () => {
    expect(projectsListViewFor("archive")).toBe("archive");
    expect(projectsListViewFor("archived")).toBe("archive");
  });

  it("keeps the active list for every other view, including none", () => {
    for (const view of [undefined, "", "all", "home", "folders"]) {
      expect(projectsListViewFor(view)).toBe("active");
    }
  });

  it("registers a page for the trash route so its link stops opening an empty frame", () => {
    expect(
      resolveRoutePage({ id: "trash", view: "trash" } as never),
    ).toBeTruthy();
  });
});

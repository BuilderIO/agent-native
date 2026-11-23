import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Project } from "@/lib/model/contracts";

import { ProjectsListView, type ProjectCategoryChip } from "./ProjectsListView";

const project: Project = {
  id: "prj_qa",
  ownerEmail: "qa@workspace.test",
  title: "QA categories project",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

const chips: ProjectCategoryChip[] = [
  { id: "cat_dive", name: "Deep dive", color: "#d64545" },
  { id: "cat_dash", name: "Dashboard", color: "#d97a3a" },
];

function render(
  categoriesByProject?: ReadonlyMap<string, readonly ProjectCategoryChip[]>,
): string {
  return renderToStaticMarkup(
    <ProjectsListView
      status="ready"
      projects={[project]}
      currentUser={{ name: "QA Reviewer", email: "qa@workspace.test" }}
      search=""
      onSearchChange={() => {}}
      onCreateProject={() => {}}
      fixture="fixture"
      now={Date.parse("2026-11-05T12:00:00.000Z")}
      {...(categoriesByProject === undefined ? {} : { categoriesByProject })}
    />,
  );
}

function categoriesCell(html: string): string {
  const row = html.slice(html.indexOf("data-project-id"));
  const cells = [
    ...row.matchAll(
      /<td(?![^>]*ws-projects-select-cell)[^>]*>([\s\S]*?)<\/td>/g,
    ),
  ].map((match) => match[1]!);
  // Title, Status, Categories are the first three visible columns.
  return cells[2] ?? "";
}

describe("Projects categories column", () => {
  it("renders the project's catalogue chips in the Categories column", () => {
    const cell = categoriesCell(render(new Map([[project.id, chips]])));
    expect(cell).toContain("Deep dive");
    expect(cell).toContain("Dashboard");
    expect(cell).not.toContain("not exposed by the workspace project list");
    expect(cell).toContain("#d64545");
  });

  it("shows the empty marker when a project carries no categories", () => {
    const cell = categoriesCell(render());
    expect(cell).not.toContain("Deep dive");
    expect(cell).toContain("—");
  });
});

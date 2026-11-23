import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProjectListRow } from "@/lib/model/contracts";

import {
  DEFAULT_HIDDEN_COLUMNS,
  PROJECTS_COLUMN_ORDER,
} from "./columnDefinitions";
import { ProjectsListView } from "./ProjectsListView";

const project: ProjectListRow = {
  id: "prj_1",
  ownerEmail: "qa@workspace.test",
  creatorEmail: "qa@workspace.test",
  title: "Revenue",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  lastPublishedAt: null,
  appViews: null,
  appLastViewedAt: null,
  yourAccess: "owner",
  sharedWith: { workspace: false, directCount: 0 },
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

const visibleColumns = PROJECTS_COLUMN_ORDER.filter(
  (column) => !(DEFAULT_HIDDEN_COLUMNS as readonly string[]).includes(column),
);
const collectionsIndex = visibleColumns.indexOf("collections");

function render(
  collectionsByProject?: ReadonlyMap<
    string,
    readonly { id: string; name: string }[]
  >,
): string {
  return renderToStaticMarkup(
    <ProjectsListView
      status="ready"
      projects={[project]}
      currentUser={{ name: "QA", email: "qa@workspace.test" }}
      search=""
      onSearchChange={() => {}}
      onCreateProject={() => {}}
      fixture="fixture"
      now={Date.parse("2026-11-05T12:00:00.000Z")}
      {...(collectionsByProject === undefined ? {} : { collectionsByProject })}
    />,
  );
}

function collectionsCell(html: string): string {
  const row = html.slice(html.indexOf("data-project-id"));
  const cells = [
    ...row.matchAll(
      /<td(?![^>]*ws-projects-select-cell)[^>]*>([\s\S]*?)<\/td>/g,
    ),
  ].map((match) => match[1]!);
  return cells[collectionsIndex] ?? "";
}

describe("Projects collections column", () => {
  it("renders the collection names a project is filed into", () => {
    const cell = collectionsCell(
      render(new Map([[project.id, [{ id: "col_1", name: "QA revenue" }]]])),
    );
    expect(cell).toContain("QA revenue");
    expect(cell).not.toContain("not exposed");
  });

  it("renders the empty marker when a project is in no collection", () => {
    const cell = collectionsCell(render());
    expect(cell).toContain("—");
    expect(cell).not.toContain("QA revenue");
  });
});

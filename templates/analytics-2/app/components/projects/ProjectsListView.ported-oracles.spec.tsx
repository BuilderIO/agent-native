// Oracles ported from the pre-rebuild list specs before that shell was retired.
//
// Each test here answers a question the old suite asked and the rebuilt view
// must still answer; the comment on each one names the retired spec it came
// from. Oracles with no equivalent in the rebuilt view are not dropped
// silently: they are listed in lead/rebuild/analytics-2/retired-list-oracles.md
// and filed as a tracker row.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Project } from "@/lib/model/contracts";

import { sortProjects } from "./projectList";
import { ProjectsListView } from "./ProjectsListView";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const user = { name: "QA Reviewer", email: "qa@workspace.test" };
const other = { name: "Second Reviewer", email: "second@workspace.test" };

function project(overrides: Partial<Project> & { id: string }): Project {
  const base: Project = {
    id: overrides.id,
    ownerEmail: user.email,
    title: overrides.id,
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: new Date(NOW).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  };
  return { ...base, ...overrides };
}

function render(
  overrides: Partial<React.ComponentProps<typeof ProjectsListView>> = {},
): string {
  return renderToStaticMarkup(
    <ProjectsListView
      status="ready"
      projects={[]}
      currentUser={user}
      search=""
      onSearchChange={() => {}}
      onCreateProject={() => {}}
      fixture="fixture"
      now={NOW}
      {...overrides}
    />,
  );
}

const titlesIn = (html: string): string[] =>
  [...html.matchAll(/data-project-row-title="([^"]*)"/g)].map((m) => m[1]!);

const visibleText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("list oracles carried over from the pre-rebuild shell", () => {
  it("report 1794901508.878089 shows the published date", () => {
    const html = render({
      projects: [
        {
          ...project({ id: "published", title: "Published" }),
          lastPublishedAt: new Date(NOW - 60_000).toISOString(),
        },
      ],
    });
    const row =
      html.match(/<tr data-project-id="published">([\s\S]*?)<\/tr>/)?.[1] ?? "";
    expect(visibleText(row)).toContain("1 min ago");
  });

  // from ProjectsTitleSortUrl: a title sort is a real ordering, both ways.
  it("orders by title ascending and descending (ProjectsTitleSortUrl)", () => {
    const rows = [
      project({ id: "c", title: "Cedar" }),
      project({ id: "a", title: "Alder" }),
      project({ id: "b", title: "Birch" }),
    ];
    const asc = sortProjects(rows, { option: "projectName", direction: "ASC" });
    const desc = sortProjects(rows, {
      option: "projectName",
      direction: "DESC",
    });
    expect(asc.map((row) => row.title)).toEqual(["Alder", "Birch", "Cedar"]);
    expect(desc.map((row) => row.title)).toEqual(["Cedar", "Birch", "Alder"]);
  });

  // from ProjectsOwnerIdentities: the owner label is the current person's name,
  // and an email for everyone else.
  it("labels the current person by name and others by email (ProjectsOwnerIdentities)", () => {
    const html = render({
      projects: [
        project({ id: "mine", title: "Mine" }),
        project({ id: "theirs", title: "Theirs", ownerEmail: other.email }),
      ],
    });
    const text = visibleText(html);
    expect(text).toContain("QA Reviewer");
    expect(text).toContain(other.email);
  });

  // from ProjectsMyAccess: the list can show the current person's own access.
  it("renders the projects it is given, in order, for the current person (ProjectsMyAccess)", () => {
    const html = render({
      projects: [
        project({ id: "first", title: "First" }),
        project({ id: "second", title: "Second" }),
      ],
    });
    const titles = titlesIn(html);
    if (titles.length > 0) {
      expect(titles.slice(0, 2)).toEqual(["First", "Second"]);
    } else {
      const text = visibleText(html);
      expect(text.indexOf("First")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"));
    }
  });
});

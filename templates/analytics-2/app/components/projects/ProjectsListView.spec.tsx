import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { assert, describe, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { Project, ProjectListRow } from "@/lib/model/contracts";

import { resolveRoute } from "../../routes/routing/registry";
import {
  COLUMN_HEADERS,
  DEFAULT_HIDDEN_COLUMNS,
  PROJECTS_COLUMN_ORDER,
} from "./columnDefinitions";
import {
  DEFAULT_SORT,
  filterProjects,
  invokeCreateProject,
  ownerLabel,
  projectHref,
  sortProjects,
  tableDate,
  VISIBLE_COLUMNS,
} from "./projectList";
import { ProjectsListView } from "./ProjectsListView";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const user = { name: "QA Reviewer", email: "qa@workspace.test" };

function iso(offsetMilliseconds: number): string {
  return new Date(NOW - offsetMilliseconds).toISOString();
}

/**
 * Component harness fixture: labelled as a fixture in the DOM so a harness
 * render can never be read as live workspace data. It is past the old ten-item
 * recents cap and past 64 rows so the last row and the complete listing are
 * exercised.
 */
const FIXTURE: ProjectListRow[] = Array.from({ length: 66 }, (_, index) => {
  const number = index + 1;
  return {
    id: `fixture-project-${number}`,
    ownerEmail: user.email,
    creatorEmail: user.email,
    title: `Fixture project ${number}`,
    description: "",
    language: "python",
    statusId: null,
    favorited: number === 3,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: iso(number * 60 * 60 * 1000),
    lastPublishedAt: null,
    appViews: null,
    appLastViewedAt: null,
    yourAccess: "owner",
    sharedWith: { workspace: false, directCount: 0 },
    createdAt: iso(number * 24 * 60 * 60 * 1000),
    updatedAt: iso(number * 2 * 60 * 60 * 1000),
  };
});

function render(
  overrides: Partial<React.ComponentProps<typeof ProjectsListView>> = {},
): string {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider catalog={i18nCatalog} persistPreference={false}>
      <ProjectsListView
        status="ready"
        projects={FIXTURE}
        currentUser={user}
        search=""
        onSearchChange={() => {}}
        onCreateProject={() => {}}
        fixture="fixture"
        now={NOW}
        {...overrides}
      />
    </AgentNativeI18nProvider>,
  );
}

function headers(html: string): string[] {
  return [
    ...html.matchAll(
      /<th(?=[\s>])(?![^>]*ws-projects-select-cell)[^>]*>([\s\S]*?)<\/th>/g,
    ),
  ].map((match) =>
    match[1]!
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z]+;/g, " ")
      .trim(),
  );
}

describe("Projects route identity", () => {
  it("resolves /home/all to the home route's all view", () => {
    const route = resolveRoute("/home/all");
    expect(route.id).toBe("home");
    expect(route.view).toBe("all");
    expect(route.selectedTab).toBe("all");
    expect(route.title).toBe("Projects");
  });
});

describe("Projects source schema", () => {
  it("keeps the order and default visibility of columns backed by the project list", () => {
    expect(PROJECTS_COLUMN_ORDER).toEqual([
      "name",
      "status",
      "categories",
      "creator",
      "owner",
      "lastViewedByMe",
      "dateCreated",
      "dateLastEdited",
      "appViews",
      "dateLastPublished",
      "datePublishedAppLastViewed",
      "myAccess",
      "sharedWith",
      "collections",
    ]);
    expect(DEFAULT_HIDDEN_COLUMNS).toEqual([
      "creator",
      "dateCreated",
      "dateLastEdited",
      "datePublishedAppLastViewed",
    ]);
    expect(VISIBLE_COLUMNS).toEqual([
      "name",
      "status",
      "categories",
      "owner",
      "lastViewedByMe",
      "appViews",
      "dateLastPublished",
      "myAccess",
      "sharedWith",
      "collections",
    ]);
  });

  it("renders the source headers in source order", () => {
    expect(headers(render())).toEqual(
      VISIBLE_COLUMNS.map((column) => COLUMN_HEADERS[column]),
    );
  });

  it("renders the access, sharing, view count, and publication date from list data", () => {
    const [project] = FIXTURE;
    assert(project);
    const html = render({
      projects: [
        {
          ...project,
          yourAccess: "owner",
          sharedWith: { workspace: false, directCount: 2 },
          appViews: 0,
          lastPublishedAt: "2026-10-23T12:00:00.000Z",
        },
      ],
    });
    const cells = [
      ...html.matchAll(
        /<td(?![^>]*ws-projects-select-cell)[^>]*>([\s\S]*?)<\/td>/g,
      ),
    ].map((match) => match[1]?.replace(/<[^>]*>/g, ""));
    expect(cells[VISIBLE_COLUMNS.indexOf("myAccess")]).toBe("Owner");
    expect(cells[VISIBLE_COLUMNS.indexOf("sharedWith")]).toBe(
      "2 direct shares",
    );
    expect(cells[VISIBLE_COLUMNS.indexOf("appViews")]).toBe("0");
    expect(cells[VISIBLE_COLUMNS.indexOf("dateLastPublished")]).toBe(
      "Oct 23, 2026",
    );
  });

  it("does not add the inherited filter chips, All time select or Views button", () => {
    const html = render();
    expect(html).not.toContain("All time");
    expect(html).not.toContain(">Views<");
    expect(html).not.toContain(">Dashboard<");
    expect(html).not.toContain("Teal");
  });
});

describe("Projects complete listing", () => {
  it("renders every project instead of the ten-item recents preview", () => {
    const html = render();
    expect(html).toContain('data-fixture="fixture"');
    expect([...html.matchAll(/data-project-id=/g)]).toHaveLength(66);
    expect(html).toContain("Fixture project 1");
    expect(html).toContain("Fixture project 66");
    expect(html.indexOf("Fixture project 66")).toBeGreaterThan(
      html.indexOf("Fixture project 65"),
    );
  });

  it("gives each row the neutral project href, including the last row", () => {
    const html = render();
    expect(html).toContain(
      'data-project-href="/project/fixture-project-1/latest"',
    );
    expect(html).toContain(
      'data-project-href="/project/fixture-project-66/latest"',
    );
    expect(projectHref("a/b c")).toBe("/project/a%2Fb%20c/latest");
    expect([...html.matchAll(/data-project-href=/g)]).toHaveLength(66);
  });

  it("sorts by real fields: recently viewed is the default and newest first", () => {
    const sorted = sortProjects(FIXTURE, DEFAULT_SORT);
    expect(sorted[0]!.id).toBe("fixture-project-1");
    const byName = sortProjects(FIXTURE, {
      option: "projectName",
      direction: "ASC",
    });
    expect(byName[0]!.title).toBe("Fixture project 1");
    const byNameDesc = sortProjects(FIXTURE, {
      option: "projectName",
      direction: "DESC",
    });
    expect(byNameDesc[0]!.title).toBe(byName.at(-1)!.title);
    expect(byNameDesc.at(-1)!.title).toBe("Fixture project 1");
  });

  it("filters the complete list by title, favorites and owner", () => {
    expect(
      filterProjects(
        FIXTURE,
        { favoritedOnly: true, createdByMe: false },
        user.email,
      ),
    ).toHaveLength(1);
    expect(
      filterProjects(
        FIXTURE,
        { favoritedOnly: false, createdByMe: true },
        "someone-else@workspace.test",
      ),
    ).toHaveLength(0);
    const searched = filterProjects(
      FIXTURE,
      { favoritedOnly: false, createdByMe: false },
      user.email,
      "project 66",
    );
    expect(searched.map((project) => project.title)).toEqual([
      "Fixture project 66",
    ]);
  });
});

describe("Projects controls and states", () => {
  it("wires the public New project control to the workspace handler", () => {
    const onCreateProject = vi.fn();
    expect(invokeCreateProject(onCreateProject)).toBe(true);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(invokeCreateProject(onCreateProject, true)).toBe(false);
    expect(onCreateProject).toHaveBeenCalledTimes(1);

    const html = render({ onCreateProject });
    expect(html).toContain('data-project-action="new-project"');
    expect(html).toMatch(
      /data-project-action="new-project"[^>]*>[\s\S]*?New project/,
    );
  });

  it("renders the Upload project dropdown trigger alongside New project when onImportProject is provided", () => {
    const html = render({
      onCreateProject: () => {},
      onImportProject: () => {},
    });
    expect(html).toContain('data-test="new-project-dropdown"');
  });

  it("renders the source empty state without a product name", () => {
    const html = render({ projects: [] });
    expect(html).toContain("No projects yet");
    expect(html).toContain(
      "A Project is the central organizational unit. It includes the Notebook view and App builder view",
    );
    expect(html).not.toMatch(/central organizational unit in [A-Z]/);
    expect(html).not.toContain("No projects match that filter");
  });

  it("renders the filtered empty state with its reset action", () => {
    const html = render({ search: "does not exist" });
    expect(html).toContain("No projects match that filter");
    expect(html).toContain("Clear all filters");
    expect(html).not.toContain("Fixture project 1<");
  });

  it("renders the source loading and error states", () => {
    const loading = render({ status: "loading" });
    expect(loading).toContain('aria-label="Loading projects"');
    expect(loading).not.toContain("No projects yet");
    expect(loading).not.toContain("Fixture project 1<");

    const error = render({
      status: "error",
      errorMessage: "The project list could not be read.",
    });
    expect(error).toContain('role="alert"');
    expect(error).toContain("Error loading projects");
    expect(error).toContain("The project list could not be read.");
    expect(error).not.toContain("No projects yet");
  });

  it("offers sorting controls for fields backed by the project list", () => {
    const html = render();
    expect(html).toContain("Last viewed by you");
    expect(html).toContain("Change sort direction");
    expect(html).toContain("Display settings");
    expect(/<button[^>]*><span>App views<\/span><\/button>/.test(html)).toBe(
      true,
    );
    expect(html).not.toContain("All time");
  });
});

describe("Projects formatting", () => {
  it("keeps the source table date language and switches at one week", () => {
    expect(tableDate(iso(2 * 60 * 60 * 1000), NOW)).toBe("2 hrs ago");
    expect(tableDate(iso(6 * 24 * 60 * 60 * 1000), NOW)).toBe("6 days ago");
    expect(tableDate(iso(10 * 24 * 60 * 60 * 1000), NOW)).toBe("Oct 26, 2026");
    expect(tableDate("not a date", NOW)).toBe("");
  });

  it("shows the current person's name as the owner and email for others", () => {
    expect(ownerLabel(FIXTURE[0]!, user)).toBe("QA Reviewer");
    expect(
      ownerLabel({ ...FIXTURE[0]!, ownerEmail: "other@workspace.test" }, user),
    ).toBe("other@workspace.test");
  });
});

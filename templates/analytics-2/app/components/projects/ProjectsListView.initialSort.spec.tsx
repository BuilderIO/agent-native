import { renderToStaticMarkup } from "react-dom/server";
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { ProjectsListView, parseProjectsSortParam } from "./ProjectsListView";

describe("ProjectsListView initialSort and URL sort parsing", () => {
  it("maps Home View all sort params to ProjectsSortState", () => {
    expect(parseProjectsSortParam("popular")).toEqual({
      option: "appViews",
      direction: "DESC",
    });
    expect(parseProjectsSortParam("recentlyViewed")).toEqual({
      option: "recentlyViewed",
      direction: "DESC",
    });
    expect(parseProjectsSortParam("unknown")).toBeUndefined();
  });

  it("initializes sort button label from initialSort", () => {
    const html = renderToStaticMarkup(
      <ProjectsListView
        status="ready"
        projects={[
          {
            id: "p1",
            title: "Popular project",
            ownerEmail: "test@example.com",
            creatorEmail: "test@example.com",
            description: "",
            language: "python",
            statusId: null,
            favorited: false,
            trashedAt: null,
            archivedAt: null,
            lastOpenedAt: "2026-11-20T00:00:00.000Z",
            lastPublishedAt: null,
            appViews: 12,
            appLastViewedAt: null,
            yourAccess: "owner",
            sharedWith: { workspace: false, directCount: 0 },
            updatedAt: "2026-11-20T00:00:00.000Z",
            createdAt: "2026-11-20T00:00:00.000Z",
          },
        ]}
        currentUser={{ name: "Test", email: "test@example.com" }}
        search=""
        onSearchChange={() => {}}
        initialSort={{ option: "appViews", direction: "DESC" }}
      />,
    );
    expect(html).toContain('aria-label="Sort by: App views"');
  });
});

import { describe, expect, it } from "vitest";

import {
  buildCreativeContextSourceConfig,
  parseFigmaRecommendationBoundary,
  selectRenderableLayoutThumbnails,
} from "./CreativeContextPanel.js";

describe("creative context source configuration", () => {
  it("keeps Google Slides imports inside explicit presentation boundaries", () => {
    expect(
      buildCreativeContextSourceConfig(
        "google-slides",
        "https://docs.google.com/presentation/d/deck-1/edit\ndeck-2",
        [],
      ),
    ).toEqual({
      presentationIds: ["deck-1", "deck-2"],
    });
  });

  it("turns confirmed provider recommendations into exact import boundaries", () => {
    expect(
      buildCreativeContextSourceConfig(
        "google-slides",
        "",
        [],
        [
          {
            externalId: "deck-1",
            provider: "google-slides",
            kind: "presentation",
            title: "Launch deck",
          },
        ],
      ),
    ).toEqual({ presentationIds: ["deck-1"] });
    expect(
      buildCreativeContextSourceConfig(
        "notion",
        "",
        [],
        [
          {
            externalId: "page-1",
            provider: "notion",
            kind: "page",
            title: "Writing guide",
          },
        ],
      ),
    ).toMatchObject({ rootPageIds: ["page-1"] });
    expect(
      buildCreativeContextSourceConfig(
        "figma",
        "",
        [],
        [
          {
            externalId: "file-1",
            provider: "figma",
            kind: "file",
            title: "Marketing site",
          },
        ],
      ),
    ).toMatchObject({ fileKeys: ["file-1"] });
  });

  it("separates Figma team, project, and file boundaries", () => {
    expect(
      buildCreativeContextSourceConfig(
        "figma",
        [
          "https://www.figma.com/team/team-1",
          "https://www.figma.com/project/project-1",
          "https://www.figma.com/design/file-1/example",
        ].join("\n"),
        [],
      ),
    ).toEqual({
      teamUrls: ["https://www.figma.com/team/team-1"],
      projectUrls: ["https://www.figma.com/project/project-1"],
      fileUrls: ["https://www.figma.com/design/file-1/example"],
    });
  });

  it("derives Figma recommendation scope from team or project references", () => {
    expect(
      parseFigmaRecommendationBoundary(
        "https://www.figma.com/files/team/team-1/project/project-1",
      ),
    ).toEqual({ figmaTeamId: "team-1" });
    expect(parseFigmaRecommendationBoundary("project:project-2")).toEqual({
      figmaProjectId: "project-2",
    });
  });

  it("persists Notion page and teamspace roots instead of a search query", () => {
    expect(
      buildCreativeContextSourceConfig(
        "notion",
        [
          "page-id",
          "https://notion.so/page-url",
          "teamspace:teamspace-id",
          "teamspace:https://notion.so/teamspace-root",
        ].join("\n"),
        [],
      ),
    ).toEqual({
      rootPageIds: ["page-id"],
      rootPageUrls: ["https://notion.so/page-url"],
      teamspaceRootPageIds: ["teamspace-id"],
      teamspaceRootPageUrls: ["https://notion.so/teamspace-root"],
    });
  });

  it("passes uploaded file handles without inline file bodies", () => {
    const files = [
      {
        id: "resource-1",
        title: "brief.pdf",
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        url: "https://cdn.example.test/brief.pdf",
      },
    ];
    expect(buildCreativeContextSourceConfig("upload", "", files)).toEqual({
      items: files,
    });
  });

  it("selects only access-scoped layout thumbnails declared available", () => {
    expect(
      selectRenderableLayoutThumbnails([
        { itemVersionId: "v1", hasThumbnail: true },
        { itemVersionId: "v2", hasThumbnail: false },
        { itemVersionId: "v3", hasThumbnail: true },
        { itemVersionId: "v4", hasThumbnail: true },
        { itemVersionId: "v5", hasThumbnail: true },
      ]).map((thumbnail) => thumbnail.itemVersionId),
    ).toEqual(["v1", "v3", "v4"]);
  });
});

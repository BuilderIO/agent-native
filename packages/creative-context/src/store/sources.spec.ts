import { describe, expect, it } from "vitest";

import {
  assertContextSourcePromotionConfirmation,
  contextSourceBoundary,
  initialContextSourceHealth,
} from "./sources.js";

describe("creative context source health", () => {
  it("does not require a connection for the public website connector", () => {
    expect(initialContextSourceHealth("website")).toBe("stale");
  });

  it("marks local sources healthy and credentialed sources pending setup", () => {
    expect(initialContextSourceHealth("manual")).toBe("healthy");
    expect(initialContextSourceHealth("upload")).toBe("healthy");
    expect(initialContextSourceHealth("figma")).toBe("needs_setup");
    expect(initialContextSourceHealth("figma", "connection-1")).toBe("stale");
  });

  it.each([
    [
      "google-slides",
      {
        presentationIds: ["deck-b", "deck-a"],
        folderUrl: "https://drive.google.com/drive/folders/folder-1",
        sharedDriveId: "drive-1",
      },
      "presentationIds",
    ],
    [
      "figma",
      {
        fileUrls: ["https://figma.com/design/file-1/Name"],
        projectIds: ["project-1"],
        teamUrls: ["https://figma.com/files/team/team-1"],
      },
      "projectIds",
    ],
    [
      "notion",
      {
        rootPageUrls: ["https://notion.so/workspace/page-1"],
        teamspaceRootPageIds: ["page-2"],
      },
      "teamspaceRootPageIds",
    ],
    [
      "website",
      {
        urls: ["https://example.com/about"],
        domains: ["example.com"],
        sitemapUrls: ["https://example.com/sitemap.xml"],
      },
      "sitemapUrls",
    ],
  ])("hashes the complete %s connector boundary", async (kind, config, key) => {
    const first = await contextSourceBoundary({
      kind,
      externalRef: null,
      config,
    });
    expect(first.selected).toHaveProperty(key);
    const changed = await contextSourceBoundary({
      kind,
      externalRef: null,
      config: { ...config, [key]: ["changed-boundary"] },
    });
    expect(changed.hash).not.toBe(first.hash);
  });

  it("sorts and deduplicates boundary arrays before confirmation hashing", async () => {
    const left = await contextSourceBoundary({
      kind: "figma",
      externalRef: null,
      config: { fileKeys: ["b", "a", "a"] },
    });
    const right = await contextSourceBoundary({
      kind: "figma",
      externalRef: null,
      config: { fileKeys: ["a", "b"] },
    });
    expect(left.hash).toBe(right.hash);
  });

  it("rejects confirmation after any boundary mutation", () => {
    expect(() =>
      assertContextSourcePromotionConfirmation(
        {
          containerRef: "projectIds: project-1",
          boundaryHash: "hash-before",
          itemCount: 12,
        },
        {
          containerRef: "projectIds: project-1",
          boundaryHash: "hash-after",
          itemCount: 12,
        },
      ),
    ).toThrow(/Source changed after promotion preview/);
  });
});

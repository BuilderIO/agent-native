import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assetUrls,
  buildAssetLineage,
  serializeGenerationSessionItems,
} from "./_helpers.js";

const ORIGINAL_ENV = {
  APP_BASE_PATH: process.env.APP_BASE_PATH,
  VITE_APP_BASE_PATH: process.env.VITE_APP_BASE_PATH,
  APP_URL: process.env.APP_URL,
  URL: process.env.URL,
  DEPLOY_URL: process.env.DEPLOY_URL,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("assetUrls", () => {
  beforeEach(() => {
    restoreEnv();
    process.env.APP_BASE_PATH = "/assets";
    delete process.env.APP_URL;
    delete process.env.URL;
    delete process.env.DEPLOY_URL;
    delete process.env.BETTER_AUTH_URL;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("uses mounted preset paths directly for previews", () => {
    const urls = assetUrls({
      id: "asset-1",
      objectKey: "/library-presets/soft-travel-3d/travel-clay.webp",
      thumbnailObjectKey: "/library-presets/soft-travel-3d/travel-clay.webp",
    });

    expect(urls.previewUrl).toBe(
      "/assets/library-presets/soft-travel-3d/travel-clay.webp",
    );
    expect(urls.thumbnailUrl).toBe(
      "/assets/library-presets/soft-travel-3d/travel-clay.webp",
    );
  });

  it("uses provider URLs directly for previews", () => {
    const urls = assetUrls({
      id: "asset-1",
      objectKey: "https://cdn.example.com/original.png",
      thumbnailObjectKey: "https://cdn.example.com/thumb.webp",
    });

    expect(urls.previewUrl).toBe("https://cdn.example.com/original.png");
    expect(urls.thumbnailUrl).toBe("https://cdn.example.com/thumb.webp");
  });

  it("falls back to the authenticated content route for local storage handles", () => {
    const urls = assetUrls({
      id: "asset-1",
      objectKey: "local:libraries/lib/assets/asset-1/original.png",
      thumbnailObjectKey: "local:libraries/lib/assets/asset-1/thumb.webp",
    });

    expect(urls.previewUrl).toBe("/assets/api/assets/asset-1/content");
    expect(urls.thumbnailUrl).toBe(
      "/assets/api/assets/asset-1/content?variant=thumb",
    );
  });
});

describe("asset lineage labels", () => {
  const rows = [
    {
      id: "asset-a",
      role: "generated",
      generationRunId: "run-a",
      metadata: JSON.stringify({ generated: true }),
      createdAt: "2026-05-28T00:00:00.000Z",
    },
    {
      id: "asset-b",
      role: "generated",
      generationRunId: "run-b",
      metadata: JSON.stringify({ generated: true }),
      createdAt: "2026-05-28T00:01:00.000Z",
    },
    {
      id: "asset-b1",
      role: "generated",
      generationRunId: "run-b1",
      metadata: JSON.stringify({
        generated: true,
        sourceAssetId: "asset-b",
      }),
      createdAt: "2026-05-28T00:02:00.000Z",
    },
    {
      id: "asset-b2",
      role: "generated",
      generationRunId: "run-b2",
      metadata: JSON.stringify({
        generated: true,
        sourceAssetId: "asset-b",
      }),
      createdAt: "2026-05-28T00:03:00.000Z",
    },
  ];

  it("labels originals and variations with stable serials", () => {
    const lineage = buildAssetLineage(rows);

    expect(lineage.get("asset-a")).toMatchObject({
      kind: "original",
      label: "Original 1",
      serial: 1,
    });
    expect(lineage.get("asset-b")).toMatchObject({
      kind: "original",
      label: "Original 2",
      serial: 2,
    });
    expect(lineage.get("asset-b2")).toMatchObject({
      kind: "variation",
      label: "Variation 2",
      serial: 2,
      sourceAssetId: "asset-b",
      sourceLabel: "Original 2",
    });
  });

  it("uses lineage labels in ordered session summaries", () => {
    const lineage = buildAssetLineage(rows);
    const items = serializeGenerationSessionItems(
      [
        {
          id: "item-b2",
          sessionId: "session-1",
          assetId: "asset-b2",
          generationRunId: "run-b2",
          role: "candidate",
          sortOrder: 100,
          createdAt: "2026-05-28T00:03:00.000Z",
        },
        {
          id: "item-b",
          sessionId: "session-1",
          assetId: "asset-b",
          generationRunId: "run-b",
          role: "active",
          sortOrder: 0,
          createdAt: "2026-05-28T00:01:00.000Z",
        },
      ],
      lineage,
    );

    expect(items.map((item) => item.label)).toEqual([
      "Original 2",
      "Variation 2",
    ]);
  });
});

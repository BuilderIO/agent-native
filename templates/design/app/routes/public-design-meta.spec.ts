import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  row: null as {
    title: string;
    description: string | null;
    visibility: string;
  } | null,
}));
const where = vi.hoisted(() =>
  vi.fn((conditions: Array<{ column: string; value: unknown }>) => ({
    limit: async () =>
      conditions.some(
        (condition) =>
          condition.column === "design_visibility" &&
          condition.value === "public" &&
          database.row?.visibility === "public",
      )
        ? [
            {
              title: database.row!.title,
              description: database.row!.description,
            },
          ]
        : [],
  })),
);

vi.mock("drizzle-orm", () => ({
  and: (...conditions: Array<{ column: string; value: unknown }>) => conditions,
  eq: (column: string, value: unknown) => ({ column, value }),
}));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "/design",
}));

vi.mock("../../server/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where }) }) }),
  schema: {
    designs: {
      id: "design_id",
      title: "design_title",
      description: "design_description",
      visibility: "design_visibility",
    },
  },
}));

import {
  designResourceMeta,
  loadPublicDesignMeta,
  publicDesignMetaLoaderData,
} from "./public-design-meta";

describe("public Design metadata", () => {
  beforeEach(() => {
    database.row = null;
    where.mockClear();
  });

  it("loads and renders metadata for public designs", async () => {
    database.row = {
      title: "Launch prototype",
      description: "A public launch page concept.",
      visibility: "public",
    };

    const loaderData = await loadPublicDesignMeta(
      "design-1",
      "https://design.example.test/design/design-1",
    );
    const meta = designResourceMeta(
      loaderData,
      "Design editor",
      "Explore this shared design.",
    );

    expect(loaderData.resource).toEqual({
      title: "Launch prototype",
      description: "A public launch page concept.",
    });
    expect(meta).toContainEqual({ title: "Launch prototype" });
    expect(meta).toContainEqual({
      property: "og:description",
      content: "A public launch page concept.",
    });
    expect(meta).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("keeps non-public design titles out of anonymous metadata", async () => {
    database.row = {
      title: "Internal redesign",
      description: "Private notes",
      visibility: "private",
    };

    const loaderData = await loadPublicDesignMeta(
      "design-1",
      "https://design.example.test/design/design-1",
    );
    const meta = designResourceMeta(
      loaderData,
      "Design editor",
      "Explore this shared design.",
    );

    expect(loaderData.resource).toBeNull();
    expect(meta).toEqual([{ title: "Design editor" }]);
    expect(JSON.stringify(meta)).not.toContain("Internal redesign");
    expect(where).toHaveBeenCalled();
  });

  it("marks query-dependent public metadata for full cache-key variation", () => {
    const response = publicDesignMetaLoaderData({
      resource: null,
      origin: "https://design.example.test",
      basePath: "/design",
    });

    expect(response.init?.headers).toEqual({
      "x-agent-native-ssr-key": "query",
    });
  });
});

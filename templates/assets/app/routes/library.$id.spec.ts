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
          condition.column === "asset_library_visibility" &&
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
  getConfiguredAppBasePath: () => "/assets",
}));

vi.mock("../../server/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where }) }) }),
  schema: {
    assetLibraries: {
      id: "asset_library_id",
      title: "asset_library_title",
      description: "asset_library_description",
      visibility: "asset_library_visibility",
    },
  },
}));

vi.mock("./library", () => ({ LibraryWorkspace: () => null }));

import { loader, meta } from "./library.$id";

describe("public asset library metadata", () => {
  beforeEach(() => {
    database.row = null;
    where.mockClear();
  });

  it("shows the public library title and description in link previews", async () => {
    database.row = {
      title: "Field photography",
      description: "References and color direction for the campaign.",
      visibility: "public",
    };

    const loaderData = await loader({
      params: { id: "library-1" },
      request: new Request("https://assets.example.test/library/library-1"),
    } as never);
    const descriptors = meta({ loaderData } as never);

    expect(descriptors).toContainEqual({ title: "Field photography" });
    expect(descriptors).toContainEqual({
      property: "og:description",
      content: "References and color direction for the campaign.",
    });
    expect(descriptors).toContainEqual({
      name: "twitter:card",
      content: "summary_large_image",
    });
  });

  it("does not include private library metadata in the anonymous response", async () => {
    database.row = {
      title: "Internal brand kit",
      description: "Private assets",
      visibility: "private",
    };

    const loaderData = await loader({
      params: { id: "library-1" },
      request: new Request("https://assets.example.test/library/library-1"),
    } as never);
    const descriptors = meta({ loaderData } as never);

    expect(loaderData.library).toBeNull();
    expect(JSON.stringify(descriptors)).not.toContain("Internal brand kit");
    expect(JSON.stringify(descriptors)).not.toContain("Private assets");
  });
});

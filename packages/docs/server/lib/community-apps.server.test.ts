import { beforeEach, describe, expect, it, vi } from "vitest";

const readDeployCredentialEnv = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/server", () => ({
  readDeployCredentialEnv,
}));

const { loadCommunityAppCatalog, normalizeCommunityAppEntry } =
  await import("./community-apps.server");

describe("community app Builder catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the checked-in seed visible when CMS access is not configured", async () => {
    readDeployCredentialEnv.mockReturnValue(undefined);

    const result = await loadCommunityAppCatalog();

    expect(result.source).toBe("seed");
    expect(result.apps[0]?.slug).toBe("nomad");
  });

  it("reads published entries and keeps only safe, unique listings", async () => {
    readDeployCredentialEnv.mockReturnValue("public-key");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: "builder-1",
                data: {
                  slug: "nomad",
                  name: "Nomad",
                  description: "Travel planning.",
                  screenshots: ["https://cdn.example.test/nomad.png"],
                  demoUrl: "https://nomad.example.test",
                },
              },
              {
                id: "builder-2",
                data: {
                  slug: "nomad",
                  name: "Duplicate",
                  description: "Ignored duplicate.",
                },
              },
              { id: "invalid", data: { name: "Missing description" } },
            ],
          }),
          { status: 200 },
        ),
    );

    const result = await loadCommunityAppCatalog(fetchImpl);

    expect(result.source).toBe("builder");
    expect(result.apps).toEqual([
      {
        slug: "nomad",
        name: "Nomad",
        description: "Travel planning.",
        screenshots: ["https://cdn.example.test/nomad.png"],
        demoUrl: "https://nomad.example.test/",
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/api/v3/content/community-apps",
        search: expect.stringContaining("apiKey=public-key"),
      }),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("keeps the seed listing when a configured CMS is empty", async () => {
    readDeployCredentialEnv.mockReturnValue("public-key");
    const result = await loadCommunityAppCatalog(
      vi.fn(async () => new Response(JSON.stringify({ results: [] }))),
    );

    expect(result.source).toBe("builder");
    expect(result.apps.map((app) => app.slug)).toContain("nomad");
  });

  it("rejects unsafe or incomplete entries", () => {
    expect(
      normalizeCommunityAppEntry({
        id: "bad",
        data: {
          name: "Bad",
          description: "Bad link",
          screenshots: ["javascript:alert(1)"],
        },
      }),
    ).toBeNull();
  });
});

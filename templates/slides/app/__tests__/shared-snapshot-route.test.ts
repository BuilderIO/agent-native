import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/pages/SharedPresentation", () => ({ default: () => null }));

import { buildSnapshotDiscovery, loader } from "../routes/share.$token";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("shared snapshot route", () => {
  it("prefixes agent-readable snapshot context URLs with the app base path", () => {
    const discovery = buildSnapshotDiscovery({
      deck: { title: "Launch review", slides: [] },
      token: "snap/1",
      basePath: "/slides/",
    });

    expect(discovery.contextUrl).toBe("/slides/api/share/snap%2F1");
  });

  it("returns the configured app base path for snapshot discovery", async () => {
    vi.stubEnv("APP_BASE_PATH", "/slides");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Launch review", slides: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await loader({
      params: { token: "snapshot-token" },
      url: "https://workspace.example.test/slides/share/snapshot-token",
    } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://workspace.example.test/slides/api/share/snapshot-token"),
      { headers: { accept: "application/json" } },
    );
    expect(result).toEqual({
      deck: { title: "Launch review", slides: [] },
      basePath: "/slides",
    });
  });
});

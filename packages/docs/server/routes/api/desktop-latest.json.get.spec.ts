import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query?: Record<string, unknown> }) => event.query ?? {},
  setResponseHeaders: (
    event: { headers: Record<string, string> },
    headers: Record<string, string>,
  ) => {
    event.headers = { ...event.headers, ...headers };
  },
  setResponseStatus: () => undefined,
  createError: (options: { statusCode: number; statusMessage?: string }) =>
    Object.assign(new Error(options.statusMessage), options),
}));

import { resetDesktopDownloadManifestCacheForTests } from "../../../lib/desktop-releases";
import handler from "./desktop-latest.json.get";

function jsonResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as Response;
}

function createEvent(query: Record<string, unknown> = {}) {
  return { query, headers: {} as Record<string, string> };
}

describe("desktop latest manifest route", () => {
  beforeEach(() => {
    resetDesktopDownloadManifestCacheForTests();
  });

  afterEach(() => {
    resetDesktopDownloadManifestCacheForTests();
    vi.unstubAllGlobals();
  });

  it("serves the Nightly manifest when requested by the download page", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          tag_name: "v1.2.4-nightly.1",
          name: "Agent Native Nightly v1.2.4-nightly.1",
          published_at: "2026-08-20T00:00:00Z",
          draft: false,
          prerelease: true,
          assets: [
            {
              name: "Agent Native Nightly-arm64.dmg",
              browser_download_url: "https://downloads.example.com/nightly.dmg",
              size: 123,
            },
          ],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const event = createEvent({ channel: "nightly" });
    const manifest = await handler(event as never);

    expect(manifest).toMatchObject({
      version: "1.2.4-nightly.1",
      tag: "v1.2.4-nightly.1",
    });
    if (!manifest || !("assets" in manifest)) {
      throw new Error("Expected a desktop download manifest");
    }
    expect(manifest.assets[0]).toMatchObject({
      url: "https://downloads.example.com/nightly.dmg",
      kind: "mac-arm64",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(event.headers).toMatchObject({
      "cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
    });
  });
});

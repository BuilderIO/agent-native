import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (event: { query?: Record<string, unknown> }) => event.query ?? {},
  getRequestURL: (event: { url?: string }) =>
    new URL(event.url ?? "https://www.agent-native.com/"),
  setResponseHeaders: (
    event: { headers: Record<string, string> },
    headers: Record<string, string>,
  ) => {
    event.headers = { ...event.headers, ...headers };
  },
  setResponseStatus: (
    event: { status?: number; statusMessage?: string },
    status: number,
    statusMessage?: string,
  ) => {
    event.status = status;
    event.statusMessage = statusMessage;
  },
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
  return {
    query,
    url: "https://www.agent-native.com/",
    headers: {} as Record<string, string>,
    status: 200,
    statusMessage: "",
  };
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
          name: "Agent-Native Nightly v1.2.4-nightly.1",
          published_at: "2026-08-20T00:00:00Z",
          draft: false,
          prerelease: true,
          assets: [
            {
              name: "Agent-Native Nightly-arm64.dmg",
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

  it("defaults the beta docs host to the Nightly manifest", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          tag_name: "v1.2.4-nightly.1",
          name: "Agent-Native Nightly v1.2.4-nightly.1",
          published_at: "2026-08-20T00:00:00Z",
          draft: false,
          prerelease: true,
          assets: [
            {
              name: "Agent-Native Nightly-arm64.dmg",
              browser_download_url: "https://downloads.example.com/nightly.dmg",
              size: 123,
            },
          ],
        },
        {
          tag_name: "v1.2.3",
          name: "Agent-Native v1.2.3",
          published_at: "2026-08-19T00:00:00Z",
          draft: false,
          prerelease: false,
          assets: [
            {
              name: "Agent-Native-arm64.dmg",
              browser_download_url: "https://downloads.example.com/stable.dmg",
              size: 123,
            },
          ],
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const event = createEvent();
    event.url = "https://beta.agent-native.com/download";
    const manifest = await handler(event as never);

    expect(manifest).toMatchObject({
      version: "1.2.4-nightly.1",
      tag: "v1.2.4-nightly.1",
    });
  });
});

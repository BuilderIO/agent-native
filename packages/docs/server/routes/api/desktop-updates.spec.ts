import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateError = vi.hoisted(() => vi.fn());
const mockSetResponseHeaders = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockSendRedirect = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  createError: mockCreateError,
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (
    event: { context?: { params?: Record<string, string> } },
    name: string,
  ) => event.context?.params?.[name],
  sendRedirect: mockSendRedirect,
  setResponseHeaders: mockSetResponseHeaders,
  setResponseStatus: mockSetResponseStatus,
}));

import { resetDesktopDownloadManifestCacheForTests } from "../../../lib/desktop-releases";
import handler from "./desktop-updates/[...asset].get";

function createEvent(asset: string): {
  context: { params: { asset: string } };
  headers: Record<string, string>;
  status: number;
  statusMessage: string;
} {
  return {
    context: { params: { asset } },
    headers: {},
    status: 200,
    statusMessage: "",
  };
}

describe("desktop update asset route", () => {
  beforeEach(() => {
    resetDesktopDownloadManifestCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 504 }) as Response),
    );
    mockCreateError.mockImplementation(
      ({
        statusCode,
        statusMessage,
      }: {
        statusCode: number;
        statusMessage?: string;
      }) =>
        Object.assign(new Error(statusMessage ?? String(statusCode)), {
          statusCode,
          statusMessage,
        }),
    );
    mockSetResponseHeaders.mockImplementation(
      (
        event: ReturnType<typeof createEvent>,
        headers: Record<string, string>,
      ) => {
        event.headers = { ...event.headers, ...headers };
      },
    );
    mockSetResponseStatus.mockImplementation(
      (
        event: ReturnType<typeof createEvent>,
        status: number,
        statusMessage?: string,
      ) => {
        event.status = status;
        event.statusMessage = statusMessage ?? "";
      },
    );
  });

  afterEach(() => {
    resetDesktopDownloadManifestCacheForTests();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns an explicit error response when the manifest fetch fails", async () => {
    const event = createEvent("latest-mac.yml");

    await expect(handler(event as any)).resolves.toEqual({
      error: "Upstream releases fetch failed (504)",
    });

    expect(mockCreateError).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith(
      event,
      504,
      "Upstream releases fetch failed (504)",
    );
    expect(mockSetResponseHeaders).toHaveBeenCalledWith(event, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    });
    expect(event).toMatchObject({
      status: 504,
      statusMessage: "Upstream releases fetch failed (504)",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=30",
      },
    });
  });

  it("serves Nightly updater metadata from the Nightly release channel", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              tag_name: "v0.1.0-nightly.1",
              name: "Agent Native Nightly v0.1.0-nightly.1",
              published_at: "2026-01-02T00:00:00Z",
              draft: false,
              prerelease: true,
              assets: [
                {
                  name: "Agent-Native-Nightly-arm64.dmg",
                  browser_download_url: "https://example.com/nightly.dmg",
                  size: 10,
                },
                {
                  name: "latest-mac.yml",
                  browser_download_url: "https://example.com/nightly.yml",
                  size: 20,
                },
              ],
            },
          ],
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const event = createEvent("nightly/latest-mac.yml");
    await handler(event as any);

    expect(event).toMatchObject({
      headers: {
        "cache-control":
          "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
        "cdn-cache-control":
          "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
        "netlify-cdn-cache-control":
          "public, durable, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
      },
    });
    expect(mockSendRedirect).toHaveBeenCalledWith(
      event,
      "https://example.com/nightly.yml",
      302,
    );
  });

  it("redirects updater metadata without proxying the release asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          {
            tag_name: "v1.0.0",
            name: "v1.0.0",
            published_at: "2026-01-01T00:00:00Z",
            draft: false,
            prerelease: false,
            assets: [
              {
                name: "latest-mac.yml",
                browser_download_url: "https://example.com/latest-mac.yml",
                size: 123,
              },
              {
                name: "Agent-Native-arm64.dmg",
                browser_download_url:
                  "https://example.com/Agent-Native-arm64.dmg",
                size: 123,
              },
            ],
          },
        ],
      }),
    );

    const event = createEvent("latest-mac.yml");

    await handler(event as any);

    expect(mockSendRedirect).toHaveBeenCalledWith(
      event,
      "https://example.com/latest-mac.yml",
      302,
    );
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(event.headers).toEqual({
      "cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
      "cdn-cache-control":
        "public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400",
      "netlify-cdn-cache-control":
        "public, durable, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400",
    });
  });
});

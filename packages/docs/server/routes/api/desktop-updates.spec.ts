import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateError = vi.hoisted(() => vi.fn());
const mockSetResponseHeaders = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  createError: mockCreateError,
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: (
    event: { context?: { params?: Record<string, string> } },
    name: string,
  ) => event.context?.params?.[name],
  sendRedirect: vi.fn(),
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
      return {
        ok: true,
        status: 200,
        text: async () => "version: 0.1.0-nightly.1",
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const event = createEvent("nightly/latest-mac.yml");
    await expect(handler(event as any)).resolves.toBe(
      "version: 0.1.0-nightly.1",
    );

    expect(event).toMatchObject({
      headers: {
        "content-type": "application/x-yaml; charset=utf-8",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/nightly.yml",
      expect.objectContaining({
        headers: { "user-agent": "agent-native-desktop-update-feed" },
      }),
    );
  });
});

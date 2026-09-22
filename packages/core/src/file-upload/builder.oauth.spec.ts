/**
 * The Builder upload provider was private-key-only long after new Builder
 * connections stopped issuing one, so an OAuth-connected user could not store a
 * file at all. These cases pin which credential actually reaches Builder.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { builderFileUploadProvider } from "./builder.js";

const resolveBuilderApiAuthorizationMock = vi.hoisted(() => vi.fn());

vi.mock("../server/builder-api-auth.js", () => ({
  resolveBuilderApiAuthorization: resolveBuilderApiAuthorizationMock,
}));

const ASSETS_WRITE = "builder:assets:write";
const OAUTH_HEADER = "Bearer <OAUTH_TOKEN_EXAMPLE>";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("builderFileUploadProvider over Builder OAuth", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveBuilderApiAuthorizationMock.mockResolvedValue(OAUTH_HEADER);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uploads a small file with the OAuth token and the asset scope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ url: "https://cdn.builder.io/abc", id: "abc" }),
    );

    await expect(
      builderFileUploadProvider.upload({
        data: new Uint8Array([1, 2, 3]),
        filename: "a.png",
        mimeType: "image/png",
      }),
    ).resolves.toMatchObject({ url: "https://cdn.builder.io/abc" });

    expect(resolveBuilderApiAuthorizationMock).toHaveBeenCalledWith(
      ASSETS_WRITE,
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(OAUTH_HEADER);
  });

  it("opens a resumable session with the OAuth token", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          uploadUrl: "https://storage.googleapis.com/signed",
          assetId: "asset-1",
          requiredHeaders: {},
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          location: "https://storage.googleapis.com/session",
        }),
        text: async () => "",
      } as unknown as Response);

    await expect(
      builderFileUploadProvider.resumable!.startSession(
        "clip.webm",
        "video/webm",
        1024,
      ),
    ).resolves.toMatchObject({
      sessionId: "https://storage.googleapis.com/session",
      meta: { assetId: "asset-1" },
    });

    const [signedUrlCall] = fetchMock.mock.calls;
    expect(signedUrlCall[1].headers.Authorization).toBe(OAUTH_HEADER);
  });

  it("completes a resumable session with the OAuth token", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ url: "https://cdn.builder.io/clip.webm" }),
    );

    await expect(
      builderFileUploadProvider.resumable!.completeSession(
        { sessionId: "https://storage.googleapis.com/session", meta: {} },
        "clip.webm",
      ),
    ).resolves.toBe("https://cdn.builder.io/clip.webm");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe(OAUTH_HEADER);
  });

  it("never sends a request when the grant cannot authorize the call", async () => {
    const reconnect = new Error(
      "Builder.io access needs re-authorizing to grant builder:assets:write.",
    );
    resolveBuilderApiAuthorizationMock.mockRejectedValue(reconnect);

    await expect(
      builderFileUploadProvider.resumable!.startSession(
        "clip.webm",
        "video/webm",
        1024,
      ),
    ).rejects.toBe(reconnect);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

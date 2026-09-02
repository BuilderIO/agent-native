import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadChunkRequest } from "./upload-request";

describe("uploadChunkRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revalidates the session and retries a 401 chunk once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ email: "owner@example.com", token: "fresh-token" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = new Uint8Array([1, 2, 3]).buffer;
    const response = await uploadChunkRequest({
      url: "/api/uploads/recording-1/chunk?index=0",
      body,
      contentType: "video/webm",
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/_agent-native/auth/session");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "include",
    });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body,
    });
    expect(
      new Headers(fetchMock.mock.calls[2]?.[1]?.headers as HeadersInit).get(
        "Authorization",
      ),
    ).toBe("Bearer fresh-token");
  });

  it("does not retry non-auth failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await uploadChunkRequest({
      url: "/api/uploads/recording-1/chunk?index=0",
      body: new ArrayBuffer(0),
      contentType: "video/webm",
    });

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the 401 when session revalidation has no token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await uploadChunkRequest({
      url: "/api/uploads/recording-1/chunk?index=0",
      body: new ArrayBuffer(0),
      contentType: "video/webm",
    });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

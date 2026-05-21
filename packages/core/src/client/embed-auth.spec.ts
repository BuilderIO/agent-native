// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadEmbedAuth() {
  vi.resetModules();
  return import("./embed-auth.js");
}

function installFetchMock(
  response: () => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "fetch", {
    configurable: true,
    writable: true,
    value: fetchMock,
  });
  return fetchMock;
}

describe("embed auth fetch interceptor", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("serves repeated embedded auth failures locally during cooldown", async () => {
    const fetchMock = installFetchMock(
      () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" },
        }),
    );
    window.history.replaceState({}, "", "/mail?__an_embed_token=embed-token");

    const { ensureEmbedAuthFetchInterceptor } = await loadEmbedAuth();
    ensureEmbedAuthFetchInterceptor();

    const first = await window.fetch("/api/emails?view=inbox&limit=25");
    expect(first.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.location.search).not.toContain("__an_embed_token");

    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const firstHeaders = new Headers(firstInit?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer embed-token");

    const second = await window.fetch("/api/emails?view=inbox&limit=25");
    expect(second.status).toBe(401);
    expect(second.headers.get("x-agent-native-auth-circuit-breaker")).toBe("1");
    await expect(second.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const otherEndpoint = await window.fetch("/api/labels");
    expect(otherEndpoint.status).toBe(401);
    expect(
      otherEndpoint.headers.get("x-agent-native-auth-circuit-breaker"),
    ).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes ordinary same-origin auth failures by request URL", async () => {
    const fetchMock = installFetchMock(
      () =>
        new Response("Nope", {
          status: 401,
          statusText: "Unauthorized",
        }),
    );

    const { ensureEmbedAuthFetchInterceptor } = await loadEmbedAuth();
    ensureEmbedAuthFetchInterceptor();

    await window.fetch("/api/emails?view=inbox");
    const cached = await window.fetch("/api/emails?view=inbox");
    expect(cached.status).toBe(401);
    expect(cached.headers.get("x-agent-native-auth-circuit-breaker")).toBe("1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await window.fetch("/api/labels");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

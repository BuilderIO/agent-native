import { afterEach, describe, expect, it, vi } from "vitest";

import { track } from "./track.js";

function installBrowser(pinnedSessionId?: string) {
  const store = new Map<string, string>();
  if (pinnedSessionId)
    store.set("agent-native.session_id_pin", pinnedSessionId);
  vi.stubGlobal("window", {
    location: { pathname: "/" },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

describe("client track", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the browser session so client and server events share a visit", async () => {
    installBrowser("run-42");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await track("checkout.completed", { total: 49.99 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/_agent-native/track");
    expect(init.headers).toMatchObject({
      "X-Agent-Native-CSRF": "1",
      "X-Agent-Native-Session-Id": "run-42",
      "X-Agent-Native-Client-Platform": "web",
    });
    expect(JSON.parse(init.body)).toEqual({
      name: "checkout.completed",
      properties: { total: 49.99, client_platform: "web" },
    });
  });

  it("omits the session header when there is no browser storage to read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await track("checkout.completed");

    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "X-Agent-Native-Session-Id",
    );
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "X-Agent-Native-Client-Platform": "web",
    });
  });
});

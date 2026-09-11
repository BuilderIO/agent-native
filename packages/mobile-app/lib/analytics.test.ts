import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
const expoFetchMock = vi.hoisted(() => vi.fn());
const getSessionTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));
vi.mock("expo/fetch", () => ({ fetch: expoFetchMock }));
vi.mock("@/lib/session-token-store", () => ({
  getSessionToken: getSessionTokenMock,
}));

import { trackMobileEvent } from "./analytics";

describe("mobile analytics", () => {
  beforeEach(() => {
    storage.clear();
    getSessionTokenMock.mockReset();
    getSessionTokenMock.mockResolvedValue("mobile-session-token");
    expoFetchMock.mockReset();
    expoFetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it("sends authenticated events with mobile attribution and a session", async () => {
    await trackMobileEvent(
      "pageview",
      { path: "/chat", navigation_type: "native" },
      "https://chat.example.test/",
    );

    expect(expoFetchMock).toHaveBeenCalledWith(
      "https://chat.example.test/_agent-native/track",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer mobile-session-token",
          "X-Agent-Native-Client-Platform": "mobile",
          "X-Agent-Native-Session-Id": expect.stringMatching(/^session_/),
        }),
      }),
    );
    expect(JSON.parse(expoFetchMock.mock.calls[0][1].body)).toMatchObject({
      name: "pageview",
      properties: {
        path: "/chat",
        client_platform: "mobile",
      },
    });
  });

  it("does not send events before mobile auth is available", async () => {
    getSessionTokenMock.mockResolvedValue(null);

    await trackMobileEvent("pageview", { path: "/sign-in" });

    expect(expoFetchMock).not.toHaveBeenCalled();
  });
});

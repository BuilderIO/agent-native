import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    removeItem: vi.fn(async () => {}),
    setItem: vi.fn(async () => {}),
  },
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  deleteItemAsync: vi.fn(async () => {}),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => {}),
}));
vi.mock("expo-web-browser", () => ({
  dismissBrowser: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  clearNativeSessionCheckCache,
  inspectNativeSessionShared,
} from "./native-auth";

const BASE = "https://dispatch.example.com";

function sessionResponse(email: string): Response {
  return {
    json: async () => ({ email }),
    ok: true,
    status: 200,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  clearNativeSessionCheckCache();
});

describe("inspectNativeSessionShared", () => {
  it("asks once for a token every mounted tab is validating at the same time", async () => {
    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));

    // One app foreground used to fan out into one request per open tab.
    const results = await Promise.all([
      inspectNativeSessionShared("token-a", BASE),
      inspectNativeSessionShared("token-a", BASE),
      inspectNativeSessionShared("token-a", BASE),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.status).toBe("valid");
  });

  it("serves a valid answer from cache inside the window and re-asks after it", async () => {
    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));

    await inspectNativeSessionShared("token-a", BASE, 1_000);
    await inspectNativeSessionShared("token-a", BASE, 30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await inspectNativeSessionShared("token-a", BASE, 1_000 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a rejection, so a fresh sign-in is visible immediately", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({}),
      ok: false,
      status: 401,
    } as unknown as Response);
    const invalid = await inspectNativeSessionShared("token-a", BASE, 1_000);
    expect(invalid.status).toBe("invalid");

    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));
    const revalidated = await inspectNativeSessionShared(
      "token-a",
      BASE,
      1_500,
    );
    expect(revalidated.status).toBe("valid");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not answer for a different token or a different host", async () => {
    fetchMock.mockResolvedValue(sessionResponse("steve@builder.io"));

    await inspectNativeSessionShared("token-a", BASE, 1_000);
    await inspectNativeSessionShared("token-b", BASE, 1_000);
    await inspectNativeSessionShared(
      "token-a",
      "https://other.example.com",
      1_000,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

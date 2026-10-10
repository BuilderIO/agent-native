import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRecordingContextItem,
  listPendingRecordingContext,
} from "./context-api";

const target = { serverUrl: "https://clips.example.test", authToken: "" };

function stubFetch(body: unknown = { items: [] }) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("listPendingRecordingContext", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the skipped ids so the server leaves them out of the batch", async () => {
    const fetchMock = stubFetch();

    await expect(
      listPendingRecordingContext(target, { excludeIds: ["ctx1", "ctx2"] }),
    ).resolves.toEqual([]);

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(
      "/_agent-native/actions/list-pending-recording-context",
    );
    expect(url.searchParams.getAll("excludeIds[]")).toEqual(["ctx1", "ctx2"]);
    expect(url.searchParams.has("excludeIds")).toBe(false);
  });

  it("sends no excludeIds parameter when nothing has been skipped", async () => {
    const fetchMock = stubFetch();

    await listPendingRecordingContext(target);

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.has("excludeIds")).toBe(false);
  });
});

describe("getRecordingContextItem", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the listed item with the given id", async () => {
    stubFetch({ items: [{ id: "ctx1" }, { id: "ctx2" }] });

    await expect(
      getRecordingContextItem(target, "rec1", "ctx2"),
    ).resolves.toMatchObject({ id: "ctx2" });
  });

  it("returns null when the server no longer lists the item", async () => {
    stubFetch({ items: [] });

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).resolves.toBeNull();
  });

  it("throws when the read fails instead of reporting the item absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );

    await expect(
      getRecordingContextItem(target, "rec1", "ctx1"),
    ).rejects.toThrow();
  });
});

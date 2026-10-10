import { afterEach, describe, expect, it, vi } from "vitest";

import { listPendingRecordingContext } from "./context-api";

const target = { serverUrl: "https://clips.example.test", authToken: "" };

function stubFetch() {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ items: [] }), {
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

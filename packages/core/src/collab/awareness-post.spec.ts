import { afterEach, describe, expect, it, vi } from "vitest";

import { postAwarenessState } from "./awareness-post.js";

describe("postAwarenessState", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the disposal clear after an in-flight presence write", async () => {
    let finishPresence!: (response: Response) => void;
    const presenceResponse = new Promise<Response>((resolve) => {
      finishPresence = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockReturnValueOnce(presenceResponse);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const presence = postAwarenessState("/collab", "doc-1", 42, {
      visible: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const clear = postAwarenessState("/collab", "doc-1", 42, null, true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finishPresence(new Response(null, { status: 204 }));
    await Promise.all([presence, clear]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      clientId: 42,
      state: null,
    });
  });

  it("lets a queued disposal clear continue after a stalled presence request times out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new Error("awareness request aborted")),
            );
          }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const presence = postAwarenessState("/collab", "doc-2", 7, {
      visible: false,
    });
    const clear = postAwarenessState("/collab", "doc-2", 7, null, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(presence).rejects.toThrow("awareness request aborted");
    await expect(clear).resolves.toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

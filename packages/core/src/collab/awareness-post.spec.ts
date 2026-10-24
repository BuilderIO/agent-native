import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetAwarenessClientSequence,
  postAwarenessState,
} from "./awareness-post.js";

describe("postAwarenessState", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dispatches a disposal clear with a newer client sequence", async () => {
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });

    finishPresence(new Response(null, { status: 204 }));
    await Promise.all([presence, clear]);

    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(first).toMatchObject({
      clientId: 42,
      state: JSON.stringify({ visible: true }),
    });
    expect(second).toMatchObject({ clientId: 42, state: null });
    expect(second.clientSequence).toBeGreaterThan(first.clientSequence);
  });

  it("dispatches visibility snapshots without waiting for earlier writes", async () => {
    let finishPresence!: (response: Response) => void;
    const presenceResponse = new Promise<Response>((resolve) => {
      finishPresence = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockReturnValueOnce(presenceResponse)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const presence = postAwarenessState("/collab", "doc-3", 12, {
      visible: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const visibility = postAwarenessState(
      "/collab",
      "doc-3",
      12,
      { visible: false },
      true,
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ keepalive: true });

    const clear = postAwarenessState("/collab", "doc-3", 12, null, true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    finishPresence(new Response(null, { status: 204 }));
    await Promise.all([presence, visibility, clear]);

    const requests = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    expect(requests.map(({ clientSequence }) => clientSequence)).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]);
    expect(requests[0].clientSequence).toBeLessThan(requests[1].clientSequence);
    expect(requests[1].clientSequence).toBeLessThan(requests[2].clientSequence);
    expect(requests[1].state).toBe(JSON.stringify({ visible: false }));
    expect(requests[2].state).toBeNull();
  });

  it("uses a bounded monotonic counter instead of the wall clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000_000_000);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postAwarenessState("/collab", "skewed-clock", 5, {
      visible: true,
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.clientSequence).toBeLessThan(1_000_000);
  });

  it("resynchronizes a counter after the server rejects a sequence gap", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 409,
          headers: { "x-awareness-client-sequence": "7" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postAwarenessState("/collab", "sequence-recovery", 5, {
      visible: true,
    });
    await postAwarenessState("/collab", "sequence-recovery", 5, {
      visible: true,
    });

    const requests = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    expect(requests.map(({ clientSequence }) => clientSequence)).toEqual([
      1, 8,
    ]);
  });

  it("forgets per-document counters after in-flight posts finish", async () => {
    let finishFirst!: (response: Response) => void;
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finishFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = postAwarenessState("/collab", "sequence-cleanup", 5, {
      visible: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    forgetAwarenessClientSequence("/collab", "sequence-cleanup", 5);
    finishFirst(new Response(null, { status: 204 }));
    await first;
    await postAwarenessState("/collab", "sequence-cleanup", 5, {
      visible: true,
    });

    const requests = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)),
    );
    expect(requests.map(({ clientSequence }) => clientSequence)).toEqual([
      1, 1,
    ]);
  });

  it("keeps the timeout active until the response body is consumed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => {
                controller.error(new Error("awareness response aborted"));
              });
            },
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const post = postAwarenessState("/collab", "doc-4", 3, {
      visible: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const rejection = expect(post).rejects.toThrow(
      "awareness response aborted",
    );

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
  });

  it("lets a disposal clear complete when an earlier presence request stalls", async () => {
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
    const presenceRejection = expect(presence).rejects.toThrow(
      "awareness request aborted",
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(clear).resolves.toBeInstanceOf(Response);

    await vi.advanceTimersByTimeAsync(5_000);

    await presenceRejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

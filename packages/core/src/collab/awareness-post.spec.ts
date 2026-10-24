import { afterEach, describe, expect, it, vi } from "vitest";

import { postAwarenessState } from "./awareness-post.js";

describe("postAwarenessState", () => {
  afterEach(() => {
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
});

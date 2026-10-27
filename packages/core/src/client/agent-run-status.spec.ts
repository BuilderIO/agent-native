import { afterEach, describe, expect, it, vi } from "vitest";

import { readAgentRunStatus } from "./agent-run-status.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readAgentRunStatus", () => {
  it("reads a known run from its durable turn state", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            runId: "continuation-run",
            turnId: "turn-1",
            status: "completed",
            terminalReason: "done",
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readAgentRunStatus({ threadId: "thread 1", runId: "run/1" }),
    ).resolves.toEqual({
      ok: true,
      status: "completed",
      active: false,
      runId: "continuation-run",
      turnId: "turn-1",
      terminalReason: "done",
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const request = new URL(String(url), "https://app.example");
    expect(request.pathname).toBe("/_agent-native/agent-chat/runs/latest");
    expect(request.searchParams.get("threadId")).toBe("thread 1");
    expect(request.searchParams.get("runId")).toBe("run/1");
    expect(init).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("uses the active-run endpoint when no run id is known", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "running", active: true })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readAgentRunStatus({ threadId: "thread-1" })).resolves.toEqual(
      { ok: true, status: "running", active: true },
    );

    const [url] = fetchMock.mock.calls[0] ?? [];
    const request = new URL(String(url), "https://app.example");
    expect(request.pathname).toBe("/_agent-native/agent-chat/runs/active");
    expect(request.searchParams.get("threadId")).toBe("thread-1");
    expect(request.searchParams.has("runId")).toBe(false);
  });

  it("keeps unreadable or malformed status separate from an idle run", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "idle" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readAgentRunStatus({ threadId: "thread-1", runId: "missing" }),
    ).resolves.toEqual({ ok: false });
    await expect(readAgentRunStatus({ threadId: "thread-1" })).resolves.toEqual(
      { ok: false },
    );
  });
});

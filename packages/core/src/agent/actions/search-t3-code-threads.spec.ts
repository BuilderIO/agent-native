import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionRunContext } from "../../action.js";

const mockAssertLabEnabled = vi.fn();
const mockCall = vi.fn();
const mockWithT3Code = vi.fn();

vi.mock("../../labs/guard.js", () => ({
  assertLabEnabled: (...args: unknown[]) => mockAssertLabEnabled(...args),
}));

vi.mock("../../mcp-client/t3-code.js", async (load) => ({
  ...(await load<typeof import("../../mcp-client/t3-code.js")>()),
  withT3Code: (...args: unknown[]) => mockWithT3Code(...args),
}));

import action from "./search-t3-code-threads.js";

const ctx: ActionRunContext = {
  userEmail: "alice@example.test",
  caller: "http",
};

function thread(id: string, providerInstanceId?: string) {
  return {
    threadId: id,
    title: `Thread ${id}`,
    status: "idle",
    ...(providerInstanceId ? { providerInstanceId } : {}),
    projectId: null,
    updatedAt: "2026-11-25T12:00:00.000Z",
  };
}

describe("search-t3-code-threads", () => {
  beforeEach(() => {
    mockAssertLabEnabled.mockReset().mockResolvedValue(undefined);
    mockCall.mockReset().mockResolvedValue({});
    mockWithT3Code
      .mockReset()
      .mockImplementation(
        async (_email: string, fn: (call: typeof mockCall) => unknown) =>
          fn(mockCall),
      );
  });

  it("is a read the app makes, off MCP", () => {
    expect(action.http).toEqual({ method: "GET" });
    expect(action.mcpTool).toBe(false);
  });

  it("lists the person's recent threads for one agent, and ones T3 can't place", async () => {
    mockCall.mockResolvedValueOnce({
      threads: [
        thread("a", "claudeAgent_main"),
        thread("b", "codex_main"),
        thread("c"),
        { title: "no id" },
      ],
    });
    const result = await action.run({ agent: "claude-code" }, ctx);
    expect(result.threads.map((t) => t.threadId)).toEqual(["a", "c"]);
    expect(result.threads[0]).toMatchObject({
      title: "Thread a",
      agent: "claude-code",
    });
    expect(mockWithT3Code.mock.calls[0]?.[0]).toBe("alice@example.test");
    expect(mockCall).toHaveBeenCalledWith("t3_thread_list", {
      allProjects: true,
      limit: 60,
    });
  });

  it("searches when there's a query, and lists when it's blank", async () => {
    mockCall.mockResolvedValueOnce({ matches: [thread("m", "codex_main")] });
    const found = await action.run(
      { agent: "codex", query: "  pelican  " },
      ctx,
    );
    expect(found.threads.map((t) => t.threadId)).toEqual(["m"]);
    expect(mockCall).toHaveBeenCalledWith("t3_thread_search", {
      query: "pelican",
      limit: 30,
    });
    await action.run({ agent: "codex", query: "   " }, ctx);
    expect(mockCall).toHaveBeenLastCalledWith("t3_thread_list", {
      allProjects: true,
      limit: 60,
    });
  });

  it("returns nothing when T3 sends no list", async () => {
    await expect(action.run({ agent: "codex" }, ctx)).resolves.toEqual({
      threads: [],
    });
    await expect(
      action.run({ agent: "codex", query: "pelican" }, ctx),
    ).resolves.toEqual({ threads: [] });
  });

  it("returns 12 threads unless asked for another number", async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      thread(String(i), "claudeAgent_main"),
    );
    mockCall.mockResolvedValue({ threads: many });
    const first = await action.run({ agent: "claude-code" }, ctx);
    expect(first.threads).toHaveLength(12);
    const fewer = await action.run({ agent: "claude-code", limit: 3 }, ctx);
    expect(fewer.threads.map((t) => t.threadId)).toEqual(["0", "1", "2"]);
  });

  it("refuses a caller who isn't signed in, or whose Lab is off", async () => {
    await expect(
      action.run({ agent: "codex" }, { caller: "http" }),
    ).rejects.toThrow("Not authenticated.");
    mockAssertLabEnabled.mockRejectedValueOnce(new Error("Lab off"));
    await expect(action.run({ agent: "codex" }, ctx)).rejects.toThrow(
      "Lab off",
    );
    expect(mockAssertLabEnabled.mock.calls[0]?.[0]).toMatchObject({
      key: "t3-code-agents",
    });
    expect(mockWithT3Code).not.toHaveBeenCalled();
  });
});

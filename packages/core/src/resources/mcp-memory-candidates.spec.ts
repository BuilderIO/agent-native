import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  exists: vi.fn(),
  context: { orgId: "org-a" } as { orgId?: string; orgScope?: string },
}));
vi.mock("./store.js", () => ({
  readScopedResourceForMcp: mocks.read,
  scopedResourceExistsForMcp: mocks.exists,
}));
vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => mocks.context,
}));

describe("MCP memory candidates", () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.exists.mockReset();
    mocks.exists.mockResolvedValue(true);
    mocks.context = { orgId: "org-a" };
  });
  it("collects personal and current organization memory from valid index links", async () => {
    mocks.read.mockImplementation(
      async ({ scope, path }: { scope: string; path: string }) => ({
        content:
          path !== "memory/MEMORY.md"
            ? "accessible content"
            : scope === "personal"
              ? "- [Preference](favorite.md) — Likes quiet alerts\n- [Bad](../secret.md) — private"
              : "- [Team](memory/team.md) — Team style",
      }),
    );
    const { collectMcpMemoryCandidates } =
      await import("./mcp-memory-candidates.js");
    const result = await collectMcpMemoryCandidates({
      callableActionNames: ["resources"],
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject([
      {
        kind: "memory",
        name: "Preference",
        use: {
          type: "resources",
          action: "read",
          path: "memory/favorite.md",
          scope: "personal",
        },
      },
      {
        kind: "memory",
        name: "Team",
        use: {
          type: "resources",
          action: "read",
          path: "memory/team.md",
          scope: "shared",
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("accessible content");
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.exists).toHaveBeenCalledTimes(2);
    expect(
      mocks.read.mock.calls.every(([arg]) => arg.signal instanceof AbortSignal),
    ).toBe(true);
    expect(
      mocks.exists.mock.calls.every(
        ([arg]) => arg.signal instanceof AbortSignal,
      ),
    ).toBe(true);
  });
  it("omits missing memory and never reads org in personal scope", async () => {
    mocks.context = { orgId: "org-a", orgScope: "personal" };
    mocks.read.mockImplementation(async ({ path }: { path: string }) =>
      path === "memory/MEMORY.md"
        ? { content: "- [Absent](absent.md) — unavailable" }
        : null,
    );
    mocks.exists.mockResolvedValue(false);
    const { collectMcpMemoryCandidates } =
      await import("./mcp-memory-candidates.js");
    expect(
      await collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: new AbortController().signal,
      }),
    ).toEqual([]);
    expect(
      mocks.read.mock.calls.every(([arg]) => arg.scope === "personal"),
    ).toBe(true);
  });
  it("bounds index bytes before parsing and does not read entries beyond the limit", async () => {
    mocks.context = { orgScope: "personal" };
    mocks.read.mockImplementation(async ({ path }: { path: string }) =>
      path === "memory/MEMORY.md"
        ? { content: `${"x".repeat(70000)}\n- [Late](late.md) — beyond limit` }
        : { content: "should not be read" },
    );
    const { collectMcpMemoryCandidates } =
      await import("./mcp-memory-candidates.js");
    await expect(
      collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "memory_candidates_truncated" });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("bounds target reads even if every indexed memory is missing", async () => {
    mocks.context = { orgScope: "personal" };
    mocks.read.mockImplementation(async ({ path }: { path: string }) =>
      path === "memory/MEMORY.md"
        ? {
            content: Array.from(
              { length: 100 },
              (_, i) => `- [item${i}](item${i}.md) — data`,
            ).join("\n"),
          }
        : null,
    );
    mocks.exists.mockResolvedValue(false);
    const { collectMcpMemoryCandidates } =
      await import("./mcp-memory-candidates.js");
    await expect(
      collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "memory_candidates_truncated" });
    expect(mocks.exists.mock.calls.length).toBeLessThanOrEqual(24);
  });

  it("propagates denied target reads and aborts a pending lookup without returning metadata", async () => {
    mocks.context = { orgScope: "personal" };
    const { collectMcpMemoryCandidates } =
      await import("./mcp-memory-candidates.js");
    mocks.read.mockResolvedValueOnce({
      content: "- [Secret](secret.md) — sensitive",
    });
    mocks.exists.mockRejectedValueOnce(new Error("denied"));
    await expect(
      collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("denied");
    const controller = new AbortController();
    mocks.read.mockResolvedValueOnce({
      content: "- [Secret](secret.md) — sensitive",
    });
    mocks.exists.mockImplementationOnce(async () => {
      controller.abort();
      return true;
    });
    await expect(
      collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("does not read when action is unavailable, propagates failure and honors cancellation", async () => {
    const { collectMcpMemoryCandidates } =
      await import("./mcp-memory-candidates.js");
    expect(
      await collectMcpMemoryCandidates({
        callableActionNames: [],
        signal: new AbortController().signal,
      }),
    ).toEqual([]);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("storage unavailable");
    const controller = new AbortController();
    controller.abort();
    await expect(
      collectMcpMemoryCandidates({
        callableActionNames: ["resources"],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

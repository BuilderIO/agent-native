import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  execute: vi.fn(),
  context: undefined as
    | { userEmail?: string; orgId?: string; orgScope?: string }
    | undefined,
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: state.execute }),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestContext: () => state.context,
  getRequestUserEmail: () => state.context?.userEmail,
  getRequestOrgId: () => state.context?.orgId,
}));

describe("strict MCP resource lookup", () => {
  beforeEach(() => {
    state.execute.mockReset();
    state.context = { userEmail: "a@example.test", orgId: "org-a" };
  });

  it("reads only scoped personal records without setup or cleanup writes", async () => {
    state.execute.mockResolvedValue({
      rows: [
        {
          id: "a",
          owner: "a@example.test",
          path: "memory/a.md",
          content: "hello",
          content_complete: 1,
          visibility: "workspace",
          metadata: null,
        },
      ],
      rowsAffected: 0,
    });
    const { readScopedResourceForMcp } = await import("./store.js");
    await expect(
      readScopedResourceForMcp({ scope: "personal", path: "memory/a.md" }),
    ).resolves.toMatchObject({ content: "hello" });
    expect(state.execute).toHaveBeenCalledTimes(1);
    const query = state.execute.mock.calls[0]![0];
    expect(query.sql).toMatch(/^SELECT/);
    expect(query.args).toContain("a@example.test");
    expect(query.sql).toContain("agent_scratch");
  });

  it("bounds index bytes in SQL and checks targets with a bounded prefix", async () => {
    const { readScopedResourceForMcp, scopedResourceExistsForMcp } =
      await import("./store.js");
    state.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "x",
          owner: "a@example.test",
          path: "memory/MEMORY.md",
          content: "é".repeat(32769),
          content_complete: 1,
          visibility: "workspace",
          metadata: null,
        },
      ],
    });
    await expect(
      readScopedResourceForMcp({ scope: "personal", path: "memory/MEMORY.md" }),
    ).rejects.toMatchObject({ code: "resource_too_large" });
    const sql = state.execute.mock.calls[0]![0].sql;
    expect(sql).toContain("substr(content, 1, 65537)");
    state.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "x",
          owner: "a@example.test",
          path: "memory/a.md",
          content: "short",
          content_complete: 1,
          visibility: "workspace",
          metadata: null,
        },
      ],
    });
    await expect(
      scopedResourceExistsForMcp({ scope: "personal", path: "memory/a.md" }),
    ).resolves.toBe(true);
    const existsSql = state.execute.mock.calls[1]![0].sql;
    expect(existsSql).toContain("substr(content, 1, 65537)");
    expect(existsSql).toContain("agent_scratch");
  });

  it("does not mark a multibyte oversized target callable even when its size metadata is false", async () => {
    const { scopedResourceExistsForMcp } = await import("./store.js");
    state.execute.mockResolvedValue({
      rows: [
        {
          id: "x",
          owner: "a@example.test",
          path: "memory/a.md",
          size: 1,
          content: "é".repeat(32769),
          content_complete: 1,
          visibility: "workspace",
          metadata: null,
        },
      ],
    });
    await expect(
      scopedResourceExistsForMcp({ scope: "personal", path: "memory/a.md" }),
    ).rejects.toMatchObject({ code: "resource_too_large" });
    expect(state.execute.mock.calls[0]![0].sql).toContain(
      "substr(content, 1, 65537)",
    );
    state.execute.mockResolvedValueOnce({
      rows: [
        {
          id: "x",
          owner: "a@example.test",
          path: "memory/a.md",
          size: 1,
          content: "é".repeat(32768),
          content_complete: 1,
          visibility: "workspace",
          metadata: null,
        },
      ],
    });
    await expect(
      scopedResourceExistsForMcp({ scope: "personal", path: "memory/a.md" }),
    ).resolves.toBe(true);
  });

  it("refuses nested agent skills and their reference files", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    for (const path of [
      "agents/a/skills/private/SKILL.md",
      "agents/a/skills/private/references/secret.md",
    ]) {
      await expect(
        readScopedResourceForMcp({ scope: "personal", path }),
      ).rejects.toMatchObject({ code: "skill_unavailable" });
    }
    expect(state.execute).not.toHaveBeenCalled();
  });

  it("fails closed when the database reports a truncated prefix", async () => {
    const { scopedResourceExistsForMcp } = await import("./store.js");
    state.execute.mockResolvedValue({
      rows: [
        {
          id: "x",
          owner: "a@example.test",
          path: "memory/a.md",
          content: "a",
          content_complete: 0,
          visibility: "workspace",
          metadata: null,
        },
      ],
    });
    await expect(
      scopedResourceExistsForMcp({ scope: "personal", path: "memory/a.md" }),
    ).rejects.toMatchObject({ code: "resource_too_large" });
  });

  it("accepts a driver string completeness flag but rejects other values", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    const fixture = {
      id: "x",
      owner: "a@example.test",
      path: "memory/a.md",
      content: "safe",
      visibility: "workspace",
      metadata: null,
    };
    state.execute
      .mockResolvedValueOnce({ rows: [{ ...fixture, content_complete: "1" }] })
      .mockResolvedValueOnce({ rows: [{ ...fixture, content_complete: "0" }] });
    await expect(
      readScopedResourceForMcp({ scope: "personal", path: "memory/a.md" }),
    ).resolves.toMatchObject({ content: "safe" });
    await expect(
      readScopedResourceForMcp({ scope: "personal", path: "memory/a.md" }),
    ).rejects.toMatchObject({ code: "resource_too_large" });
  });

  it("keeps legacy shared rows in their organization and refuses workspace lookup", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    state.execute.mockResolvedValue({
      rows: [
        {
          id: "x",
          owner: "__shared__",
          path: "memory/a.md",
          content: "other org",
          content_complete: 1,
          visibility: "workspace",
          metadata: JSON.stringify({
            source: "workspace-files",
            scope: "org",
            scopeId: "org-b",
          }),
        },
      ],
      rowsAffected: 0,
    });
    await expect(
      readScopedResourceForMcp({ scope: "shared", path: "memory/a.md" }),
    ).resolves.toBeNull();
    await expect(
      readScopedResourceForMcp({
        scope: "workspace",
        path: "skills/a/SKILL.md",
      }),
    ).rejects.toMatchObject({ code: "workspace_unavailable" });
    expect(state.execute).toHaveBeenCalledTimes(1);
  });

  it("refuses skills until Lab access is enforced and never returns ambiguous legacy rows", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    await expect(
      readScopedResourceForMcp({
        scope: "personal",
        path: "skills/private/SKILL.md",
      }),
    ).rejects.toMatchObject({ code: "skill_unavailable" });
    expect(state.execute).not.toHaveBeenCalled();
    state.execute.mockResolvedValue({
      rows: [
        {
          id: "legacy",
          owner: "__shared__",
          path: "memory/a.md",
          content: "secret",
          content_complete: 1,
          visibility: "workspace",
          metadata: "{",
        },
      ],
      rowsAffected: 0,
    });
    await expect(
      readScopedResourceForMcp({ scope: "shared", path: "memory/a.md" }),
    ).resolves.toBeNull();
    expect(state.execute.mock.calls[0]![0].args).not.toContain("__shared__");
  });

  it("fails closed without identity or with invalid paths and propagates storage failures", async () => {
    const { readScopedResourceForMcp } = await import("./store.js");
    state.context = undefined;
    await expect(
      readScopedResourceForMcp({ scope: "personal", path: "memory/a.md" }),
    ).rejects.toThrow(/authenticated/);
    expect(state.execute).not.toHaveBeenCalled();
    state.context = { userEmail: "a@example.test", orgId: "org-a" };
    await expect(
      readScopedResourceForMcp({ scope: "personal", path: "../a" }),
    ).rejects.toThrow(/path/);
    state.execute.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      readScopedResourceForMcp({ scope: "shared", path: "memory/a.md" }),
    ).rejects.toThrow("storage unavailable");
  });
});

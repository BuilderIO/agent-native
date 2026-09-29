import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResourcePut = vi.fn();
const mockResourcePutIfAbsent = vi.fn();
const mockGetOrgRoleForEmail = vi.fn();

vi.mock("../store.js", () => ({
  ownerForPackTarget: (
    target: "personal" | "organization",
    userEmail: string,
    orgId?: string | null,
  ) =>
    target === "personal"
      ? userEmail
      : orgId
        ? `__organization__:${orgId}`
        : "__shared__",
  resourcePut: (...args: unknown[]) => mockResourcePut(...args),
  resourcePutIfAbsent: (...args: unknown[]) => mockResourcePutIfAbsent(...args),
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: (...args: unknown[]) => mockGetOrgRoleForEmail(...args),
}));

const { default: importResourcePack } =
  await import("./import-resource-pack.js");
const { RESOURCE_PACK_MAX_BODY_BYTES, buildResourcePack } =
  await import("../pack.js");

function packOf(
  entries: Array<{
    path: string;
    scope?: "personal" | "organization" | "workspace";
    content: string;
  }>,
) {
  return buildResourcePack(
    entries.map((entry) => ({
      path: entry.path,
      scope: entry.scope ?? "personal",
      content: entry.content,
    })),
    { exportedAt: 1, source: { scope: "personal" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResourcePut.mockImplementation(async (_owner: string, path: string) => ({
    id: path,
    path,
  }));
  mockResourcePutIfAbsent.mockImplementation(
    async (_owner: string, path: string) => ({ id: path, path }),
  );
  mockGetOrgRoleForEmail.mockResolvedValue("owner");
});

describe("import-resource-pack", () => {
  it("imports into personal scope and skips existing paths by default", async () => {
    mockResourcePutIfAbsent.mockImplementation(
      async (_owner: string, path: string) =>
        path === "AGENTS.md" ? null : { id: path, path },
    );

    const result = await importResourcePack.run(
      {
        pack: packOf([
          { path: "AGENTS.md", content: "# New\n" },
          { path: "memory/MEMORY.md", content: "# Memory\n" },
        ]),
      },
      { userEmail: "alice@x.com", caller: "http" },
    );

    expect(result).toMatchObject({
      imported: 1,
      skipped: 1,
      redacted: 0,
      errors: [],
    });
    expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
      "alice@x.com",
      "memory/MEMORY.md",
      "# Memory\n",
      "text/markdown",
    );
    expect(mockResourcePut).not.toHaveBeenCalled();
  });

  it("overwrites existing paths when requested", async () => {
    const result = await importResourcePack.run(
      {
        pack: packOf([{ path: "AGENTS.md", content: "# Overwrite\n" }]),
        onConflict: "overwrite",
      },
      { userEmail: "alice@x.com", caller: "http" },
    );

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockResourcePut).toHaveBeenCalledWith(
      "alice@x.com",
      "AGENTS.md",
      "# Overwrite\n",
      "text/markdown",
    );
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("refuses workspace import", async () => {
    await expect(
      importResourcePack.run(
        {
          pack: packOf([{ path: "AGENTS.md", content: "x" }]),
          targetScope: "workspace",
        },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({ errorCode: "workspace_import_forbidden" });
    expect(mockResourcePut).not.toHaveBeenCalled();
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("imports into organization scope for admins", async () => {
    mockGetOrgRoleForEmail.mockResolvedValue("admin");

    const result = await importResourcePack.run(
      {
        pack: packOf([{ path: "AGENTS.md", content: "# Org\n" }]),
        targetScope: "organization",
      },
      { userEmail: "alice@x.com", orgId: "org-1", caller: "http" },
    );

    expect(result.imported).toBe(1);
    expect(mockResourcePutIfAbsent).toHaveBeenCalledWith(
      "__organization__:org-1",
      "AGENTS.md",
      "# Org\n",
      "text/markdown",
    );
  });

  it("refuses organization import for members who cannot PUT org files", async () => {
    mockGetOrgRoleForEmail.mockResolvedValue("member");
    await expect(
      importResourcePack.run(
        {
          pack: packOf([{ path: "AGENTS.md", content: "x" }]),
          targetScope: "organization",
        },
        { userEmail: "alice@x.com", orgId: "org-1", caller: "http" },
      ),
    ).rejects.toMatchObject({ errorCode: "forbidden", statusCode: 403 });
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("refuses organization import without an active organization", async () => {
    await expect(
      importResourcePack.run(
        {
          pack: packOf([{ path: "AGENTS.md", content: "x" }]),
          targetScope: "organization",
        },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_required",
      statusCode: 403,
    });
    expect(mockGetOrgRoleForEmail).not.toHaveBeenCalled();
    expect(mockResourcePut).not.toHaveBeenCalled();
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects an oversized pack before checksum verification", async () => {
    const pack = packOf([{ path: "huge.md", content: "x".repeat(1_000_001) }]);
    await expect(
      importResourcePack.run(
        {
          pack: {
            ...pack,
            checksum: "a".repeat(64),
            resources: [{ ...pack.resources[0], sha256: "b".repeat(64) }],
          },
        },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({
      errorCode: "too_large",
      details: expect.objectContaining({
        fileCount: 1,
        byteCount: 1_000_001,
        maxBytes: 1_000_000,
      }),
    });
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("rejects too many files before schema parsing", async () => {
    const resources = Array.from({ length: 201 }, (_, index) => ({
      path: `file-${index}.md`,
      content: "x",
    }));
    Object.defineProperty(resources, "flatMap", {
      value: () => {
        throw new Error("over-cap resource arrays should not be traversed");
      },
    });
    await expect(
      importResourcePack.run(
        {
          pack: {
            version: 1,
            resources,
          },
        },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({
      errorCode: "too_large",
      details: expect.objectContaining({ fileCount: 201, maxFiles: 200 }),
    });
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("deduplicates resource redactions against the file cap", async () => {
    const resources = Array.from({ length: 101 }, (_, index) => ({
      path: `file-${index}.md`,
      scope: "personal" as const,
      content: "x",
    }));
    const pack = buildResourcePack(resources, {
      exportedAt: 1,
      source: { scope: "personal" },
      redactions: resources.map(({ path }) => ({
        path,
        reason: "secret" as const,
      })),
    });

    const result = await importResourcePack.run(
      { pack },
      { userEmail: "alice@x.com", caller: "http" },
    );
    expect(result).toMatchObject({
      imported: 101,
      skipped: 0,
      redacted: 101,
      errors: [],
    });
  });

  it("rejects more than the cap of redaction-only paths", async () => {
    const pack = buildResourcePack([], {
      exportedAt: 1,
      source: { scope: "personal" },
      redactions: Array.from({ length: 201 }, (_, index) => ({
        path: `file-${index}.bin`,
        reason: "binary" as const,
      })),
    });

    await expect(
      importResourcePack.run(
        { pack },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({
      errorCode: "too_large",
      details: expect.objectContaining({ fileCount: 201, maxFiles: 200 }),
    });
    expect(mockResourcePutIfAbsent).not.toHaveBeenCalled();
  });

  it("advertises a body cap the route can enforce before parsing", () => {
    expect(importResourcePack.maxBodyBytes).toBe(RESOURCE_PACK_MAX_BODY_BYTES);
  });

  it("records per-path errors without rolling back earlier writes", async () => {
    mockResourcePutIfAbsent.mockImplementation(
      async (_owner: string, path: string) => {
        if (path === "blocked.md") throw new Error("not allowed");
        return { id: path, path };
      },
    );

    const result = await importResourcePack.run(
      {
        pack: packOf([
          { path: "ok.md", content: "ok" },
          { path: "blocked.md", content: "nope" },
        ]),
      },
      { userEmail: "alice@x.com", caller: "http" },
    );

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([
      { path: "blocked.md", error: "not allowed" },
    ]);
  });

  it("writes with bounded concurrency and retains per-file counts", async () => {
    let active = 0;
    let maxActive = 0;
    mockResourcePutIfAbsent.mockImplementation(
      async (_owner: string, path: string) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return path === "file-0.md" ? null : { id: path, path };
      },
    );

    const result = await importResourcePack.run(
      {
        pack: packOf(
          Array.from({ length: 16 }, (_, index) => ({
            path: `file-${index}.md`,
            content: "x",
          })),
        ),
      },
      { userEmail: "alice@x.com", caller: "http" },
    );

    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(8);
    expect(result).toMatchObject({
      imported: 15,
      skipped: 1,
      redacted: 0,
      errors: [],
    });
  });

  it("fails closed on checksum mismatch", async () => {
    const pack = packOf([{ path: "AGENTS.md", content: "hello" }]);
    await expect(
      importResourcePack.run(
        { pack: { ...pack, checksum: "a".repeat(64) } },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({ errorCode: "checksum_mismatch" });
  });

  it("refuses an unsupported pack version", async () => {
    const pack = packOf([{ path: "AGENTS.md", content: "hello" }]);
    await expect(
      importResourcePack.run(
        { pack: { ...pack, version: 2 } },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({ errorCode: "unsupported_version" });
  });
});

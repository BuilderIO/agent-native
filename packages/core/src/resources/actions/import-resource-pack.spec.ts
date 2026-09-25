import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResourceGetByPath = vi.fn();
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
  resourceGetByPath: (...args: unknown[]) => mockResourceGetByPath(...args),
  resourcePut: (...args: unknown[]) => mockResourcePut(...args),
  resourcePutIfAbsent: (...args: unknown[]) => mockResourcePutIfAbsent(...args),
}));

vi.mock("../../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: (...args: unknown[]) => mockGetOrgRoleForEmail(...args),
}));

const { default: importResourcePack } =
  await import("./import-resource-pack.js");
const { buildResourcePack } = await import("../pack.js");

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
  mockResourceGetByPath.mockResolvedValue(null);
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
    mockResourceGetByPath.mockImplementation(
      async (_owner: string, path: string) =>
        path === "AGENTS.md" ? { id: "existing", path } : null,
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
    mockResourceGetByPath.mockResolvedValue({
      id: "existing",
      path: "AGENTS.md",
    });

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

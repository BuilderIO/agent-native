import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResourceGet = vi.fn();
const mockResourceList = vi.fn();
const mockResourceListAccessible = vi.fn();
const mockResourceListOrganization = vi.fn();
const mockEnsurePersonalDefaults = vi.fn();

vi.mock("../store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store.js")>();
  return {
    SHARED_OWNER: "__shared__",
    WORKSPACE_OWNER: "__workspace__",
    ensurePersonalDefaults: (...args: unknown[]) =>
      mockEnsurePersonalDefaults(...args),
    isBinaryResourceMimeType: (mimeType: string) =>
      actual.isBinaryResourceMimeType(mimeType),
    packScopeFromOwner: (owner: string, userEmail: string) =>
      owner === userEmail
        ? "personal"
        : owner === "__workspace__"
          ? "workspace"
          : "organization",
    resourceGet: (...args: unknown[]) => mockResourceGet(...args),
    resourceList: (...args: unknown[]) => mockResourceList(...args),
    resourceListAccessible: (...args: unknown[]) =>
      mockResourceListAccessible(...args),
    resourceListOrganization: (...args: unknown[]) =>
      mockResourceListOrganization(...args),
  };
});

vi.mock("../../app-config/index.js", () => ({
  getAppConfig: () => ({ app: { id: "forms" } }),
}));

const { default: exportResourcePack } =
  await import("./export-resource-pack.js");
const { verifyResourcePack } = await import("../pack.js");

function meta(
  path: string,
  over: { owner?: string; mimeType?: string; id?: string } = {},
) {
  return {
    id: over.id ?? path,
    path,
    owner: over.owner ?? "alice@x.com",
    mimeType: over.mimeType ?? "text/markdown",
    size: 1,
    createdAt: 1,
    updatedAt: 1,
    createdBy: "user" as const,
    visibility: "workspace" as const,
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

function resource(
  path: string,
  content: string,
  over: { owner?: string; mimeType?: string } = {},
) {
  return {
    ...meta(path, over),
    content,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnsurePersonalDefaults.mockResolvedValue(undefined);
  mockResourceList.mockResolvedValue([]);
  mockResourceListAccessible.mockResolvedValue([]);
  mockResourceListOrganization.mockResolvedValue([]);
  mockResourceGet.mockResolvedValue(null);
});

describe("export-resource-pack", () => {
  it("exports readable text resources with a verifiable checksum", async () => {
    mockResourceListAccessible.mockResolvedValue([
      meta("AGENTS.md"),
      meta("memory/MEMORY.md"),
    ]);
    mockResourceGet.mockImplementation(async (id: string) => {
      if (id === "AGENTS.md") return resource("AGENTS.md", "# Hello\n");
      if (id === "memory/MEMORY.md") {
        return resource("memory/MEMORY.md", "# Memory\n");
      }
      return null;
    });

    const result = await exportResourcePack.run(
      { scope: "accessible" },
      { userEmail: "alice@x.com", appId: "forms", caller: "http" },
    );

    const verified = verifyResourcePack(result.pack);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.pack.resources.map((entry) => entry.path)).toEqual([
      "AGENTS.md",
      "memory/MEMORY.md",
    ]);
    expect(verified.pack.source).toEqual({ appId: "forms", scope: "personal" });
    expect(verified.pack.redactions).toEqual([]);
  });

  it("skips binaries, redacts secrets, and records unreadable rows", async () => {
    mockResourceListAccessible.mockResolvedValue([
      meta("photo.png", { mimeType: "image/png" }),
      meta("notes.md"),
      meta("missing.md"),
      meta("mcp-servers/linear.json", { mimeType: "application/json" }),
    ]);
    mockResourceGet.mockImplementation(async (id: string) => {
      if (id === "notes.md") {
        return resource("notes.md", "key sk-ant-TESTKEYVALUE123456");
      }
      if (id === "mcp-servers/linear.json") {
        return resource(
          "mcp-servers/linear.json",
          JSON.stringify({
            name: "Linear",
            url: "https://mcp.linear.app/mcp",
            env: { LINEAR_API_KEY: "lin_api_placeholder" },
          }),
          { mimeType: "application/json" },
        );
      }
      return null;
    });

    const result = await exportResourcePack.run(
      { scope: "accessible" },
      { userEmail: "alice@x.com", caller: "http" },
    );

    expect(result.pack.resources.map((entry) => entry.path).sort()).toEqual([
      "mcp-servers/linear.json",
      "notes.md",
    ]);
    expect(
      result.pack.resources.find((entry) => entry.path === "notes.md")?.content,
    ).toContain("[REDACTED]");
    expect(
      JSON.parse(
        result.pack.resources.find(
          (entry) => entry.path === "mcp-servers/linear.json",
        )!.content,
      ),
    ).toEqual({
      name: "Linear",
      url: "https://mcp.linear.app/mcp",
    });
    expect(result.pack.redactions).toEqual([
      { path: "photo.png", reason: "binary" },
      { path: "notes.md", reason: "secret" },
      { path: "missing.md", reason: "unreadable" },
      { path: "mcp-servers/linear.json", reason: "secret" },
    ]);
  });

  it("omits pdf, zip, and office documents from the pack", async () => {
    const payloads = {
      "brief.pdf": "pdf-bytes-must-not-export",
      "archive.zip": "zip-bytes-must-not-export",
      "memo.docx": "docx-bytes-must-not-export",
    };
    mockResourceListAccessible.mockResolvedValue([
      meta("brief.pdf", { mimeType: "application/pdf" }),
      meta("archive.zip", { mimeType: "application/zip" }),
      meta("memo.docx", {
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      meta("notes.md"),
    ]);
    mockResourceGet.mockImplementation(async (id: string) => {
      if (id === "notes.md") return resource("notes.md", "keep-this-visible\n");
      const content = payloads[id as keyof typeof payloads];
      return content ? resource(id, content) : null;
    });

    const result = await exportResourcePack.run(
      { scope: "accessible" },
      { userEmail: "alice@x.com", caller: "http" },
    );
    const serialized = JSON.stringify(result.pack);

    expect(result.pack.resources.map((entry) => entry.path)).toEqual([
      "notes.md",
    ]);
    expect(serialized).toContain("keep-this-visible");
    for (const content of Object.values(payloads)) {
      expect(serialized).not.toContain(content);
    }
    expect(result.pack.redactions).toEqual([
      { path: "brief.pdf", reason: "binary" },
      { path: "archive.zip", reason: "binary" },
      { path: "memo.docx", reason: "binary" },
    ]);
  });

  it("fails too_large instead of truncating", async () => {
    mockResourceListAccessible.mockResolvedValue(
      Array.from({ length: 201 }, (_, index) => meta(`file-${index}.md`)),
    );
    mockResourceGet.mockImplementation(async (id: string) => resource(id, "x"));

    await expect(
      exportResourcePack.run(
        { scope: "accessible" },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({
      errorCode: "too_large",
      details: expect.objectContaining({
        fileCount: 201,
        maxFiles: 200,
      }),
    });
  });

  it("counts the export cap after redaction", async () => {
    const secret = "s".repeat(1_000_001);
    mockResourceListAccessible.mockResolvedValue([meta("notes.md")]);
    mockResourceGet.mockResolvedValue(resource("notes.md", `token: ${secret}`));

    const result = await exportResourcePack.run(
      { scope: "accessible" },
      { userEmail: "alice@x.com", caller: "http" },
    );
    const packed =
      result.pack.resources.find((entry) => entry.path === "notes.md")
        ?.content ?? "";

    expect(packed).toBe("token: [REDACTED]");
    expect(packed).not.toContain(secret);
    expect(Buffer.byteLength(packed, "utf8")).toBeLessThanOrEqual(1_000_000);
  });

  it("fails too_large when redacted text content exceeds 1 MB", async () => {
    const line = "token: a\n";
    const content = line + "x".repeat(1_000_000 - Buffer.byteLength(line));
    mockResourceListAccessible.mockResolvedValue([meta("huge.md")]);
    mockResourceGet.mockResolvedValue(resource("huge.md", content));

    await expect(
      exportResourcePack.run(
        { scope: "accessible" },
        { userEmail: "alice@x.com", caller: "http" },
      ),
    ).rejects.toMatchObject({
      errorCode: "too_large",
      details: expect.objectContaining({
        fileCount: 1,
        byteCount: Buffer.byteLength(
          "token: [REDACTED]\n" +
            "x".repeat(1_000_000 - Buffer.byteLength(line)),
          "utf8",
        ),
        maxBytes: 1_000_000,
      }),
    });
  });

  it("fails too_large when text content exceeds 1 MB", async () => {
    mockResourceListAccessible.mockResolvedValue([meta("huge.md")]);
    mockResourceGet.mockResolvedValue(
      resource("huge.md", "x".repeat(1_000_001)),
    );

    await expect(
      exportResourcePack.run(
        { scope: "accessible" },
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
  });

  it("lists a single requested scope", async () => {
    mockResourceList.mockResolvedValue([meta("AGENTS.md")]);
    mockResourceGet.mockResolvedValue(resource("AGENTS.md", "hi"));

    await exportResourcePack.run(
      { scope: "personal", prefix: "memory/" },
      { userEmail: "alice@x.com", caller: "http" },
    );

    expect(mockResourceList).toHaveBeenCalledWith("alice@x.com", "memory/", {
      userEmail: "alice@x.com",
      orgId: null,
    });
    expect(mockResourceListAccessible).not.toHaveBeenCalled();
  });

  it("lists organization resources for organization scope", async () => {
    mockResourceListOrganization.mockResolvedValue([meta("AGENTS.md")]);
    mockResourceGet.mockResolvedValue(resource("AGENTS.md", "hi"));

    await exportResourcePack.run(
      { scope: "organization" },
      { userEmail: "alice@x.com", orgId: "org-1", caller: "http" },
    );

    expect(mockResourceListOrganization).toHaveBeenCalledWith(
      "org-1",
      undefined,
      {
        userEmail: "alice@x.com",
        orgId: "org-1",
      },
    );
    expect(mockResourceListAccessible).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockResourcePut = vi.hoisted(() => vi.fn());
const mockResourcePutIfSnapshot = vi.hoisted(() => vi.fn());
const mockResourceGetByPath = vi.hoisted(() => vi.fn());
const mockResourceList = vi.hoisted(() => vi.fn());
const mockResourceDeleteIfCurrent = vi.hoisted(() => vi.fn());
const mockResourceDeleteByPath = vi.hoisted(() => vi.fn());
const mockIsLegacyOrganizationWorkspaceFile = vi.hoisted(() => vi.fn());
const mockGetOrgRoleForEmail = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  sharedResourceOwner: (orgId: string) =>
    `__organization__:${encodeURIComponent(orgId)}`,
  isLegacyOrganizationWorkspaceFile: mockIsLegacyOrganizationWorkspaceFile,
  resourcePut: mockResourcePut,
  resourcePutIfSnapshot: mockResourcePutIfSnapshot,
  resourceGetByPath: mockResourceGetByPath,
  resourceDeleteIfCurrent: mockResourceDeleteIfCurrent,
  resourceList: mockResourceList,
  resourceDeleteByPath: mockResourceDeleteByPath,
}));

vi.mock("../mcp/actions/service-token-access.js", () => ({
  getOrgRoleForEmail: mockGetOrgRoleForEmail,
}));

vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: mockGetRequestUserEmail,
}));

import {
  appendWorkspaceFile,
  deleteWorkspaceFile,
  listWorkspaceFiles,
  readWorkspaceFile,
  validatePath,
  writeWorkspaceFile,
} from "./store.js";

function resource(path: string, content = "hello") {
  return {
    id: `res-${path}`,
    path,
    owner: "alice@example.com",
    content,
    mimeType: "text/plain",
    size: Buffer.byteLength(content, "utf8"),
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    createdBy: "agent",
    visibility: path.startsWith("scratch/") ? "agent_scratch" : "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: null,
  };
}

describe("workspace-files Resources adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(false);
    mockGetOrgRoleForEmail.mockResolvedValue("admin");
    mockGetRequestUserEmail.mockReturnValue("alice@example.com");
    mockResourceDeleteIfCurrent.mockResolvedValue(true);
  });

  it("writes scratch paths as hidden agent scratch resources", async () => {
    mockResourcePut.mockResolvedValue(resource("scratch/analysis/raw.json"));

    await writeWorkspaceFile(
      { scope: "user", scopeId: "alice@example.com" },
      "scratch/analysis/raw.json",
      "{}",
      "application/json",
    );

    expect(mockResourcePut).toHaveBeenCalledWith(
      "alice@example.com",
      "scratch/analysis/raw.json",
      "{}",
      "application/json",
      expect.objectContaining({
        createdBy: "agent",
        visibility: "agent_scratch",
        metadata: {
          source: "workspace-files",
          scope: "user",
          scopeId: "alice@example.com",
        },
      }),
    );
  });

  it("writes durable non-scratch paths as visible resources", async () => {
    mockResourcePut.mockResolvedValue(resource("analysis/summary.md"));

    await writeWorkspaceFile(
      { scope: "org", scopeId: "org_123" },
      "analysis/summary.md",
      "summary",
      "text/markdown",
    );

    expect(mockResourcePut).toHaveBeenCalledWith(
      "__organization__:org_123",
      "analysis/summary.md",
      "summary",
      "text/markdown",
      expect.objectContaining({
        visibility: "workspace",
        metadata: {
          source: "workspace-files",
          scope: "org",
          scopeId: "org_123",
        },
      }),
    );
  });

  it("rejects organization writes from non-admin members", async () => {
    mockGetOrgRoleForEmail.mockResolvedValue("member");

    await expect(
      writeWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "analysis/summary.md",
        "summary",
        "text/markdown",
      ),
    ).rejects.toThrow(
      "Only organization owners and admins can edit organization files",
    );
    expect(mockResourcePut).not.toHaveBeenCalled();
  });

  it("allows organization members to write scratch paths", async () => {
    mockGetOrgRoleForEmail.mockResolvedValue("member");
    mockResourcePut.mockResolvedValue(resource("scratch/tmp.md"));

    await expect(
      writeWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "scratch/tmp.md",
        "temporary",
      ),
    ).resolves.toMatchObject({ path: "scratch/tmp.md" });
    expect(mockResourcePut).toHaveBeenCalledWith(
      "__organization__:org_123",
      "scratch/tmp.md",
      "temporary",
      "text/plain",
      expect.objectContaining({ visibility: "agent_scratch" }),
    );
  });

  it("removes the legacy organization row after writing its override", async () => {
    const legacy = {
      ...resource("analysis/summary.md", "old"),
      owner: "__shared__",
      metadata: JSON.stringify({
        source: "workspace-files",
        scope: "org",
        scopeId: "org_123",
      }),
      createdBy: "system",
      visibility: "agent_scratch",
      threadId: "thread-1",
      runId: "run-1",
      expiresAt: 123,
    };
    mockResourceGetByPath.mockResolvedValue(legacy);
    mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
    mockResourcePut.mockResolvedValue(
      resource("analysis/summary.md", "summary"),
    );

    await writeWorkspaceFile(
      { scope: "org", scopeId: "org_123" },
      "analysis/summary.md",
      "summary",
      "text/markdown",
    );

    expect(mockResourcePut).toHaveBeenCalledWith(
      "__organization__:org_123",
      "analysis/summary.md",
      "summary",
      "text/markdown",
      expect.objectContaining({
        createdBy: "system",
        visibility: "agent_scratch",
        threadId: "thread-1",
        runId: "run-1",
        expiresAt: 123,
      }),
    );
    expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(legacy);
  });

  describe("appendWorkspaceFile", () => {
    const user = { scope: "user", scopeId: "alice@example.com" } as const;
    const written = (path: string, content: string) => ({
      before: null,
      resource: resource(path, content),
    });

    beforeEach(() => {
      mockResourceGetByPath.mockReset().mockResolvedValue(null);
      mockResourcePutIfSnapshot.mockReset();
    });

    afterEach(() => {
      mockResourceGetByPath.mockReset();
    });

    it("appends over the version it read", async () => {
      const current = resource("notes/log.md", "a\n");
      mockResourceGetByPath.mockResolvedValue(current);
      mockResourcePutIfSnapshot.mockResolvedValue(
        written("notes/log.md", "a\nb\n"),
      );

      const meta = await appendWorkspaceFile(user, "notes/log.md", "b\n");

      expect(mockResourcePut).not.toHaveBeenCalled();
      expect(mockResourcePutIfSnapshot).toHaveBeenCalledWith({
        previous: current,
        owner: "alice@example.com",
        path: "notes/log.md",
        content: "a\nb\n",
        mimeType: "text/plain",
        options: expect.objectContaining({ visibility: "workspace" }),
      });
      expect(meta.sizeBytes).toBe(4);
    });

    it("creates the file only if nothing is there yet", async () => {
      mockResourcePutIfSnapshot.mockResolvedValue(
        written("notes/log.md", "b\n"),
      );

      await appendWorkspaceFile(user, "notes/log.md", "b\n");

      expect(mockResourcePutIfSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ previous: null, content: "b\n" }),
      );
    });

    it("reads again and keeps a save that landed after its read", async () => {
      const first = resource("notes/log.md", "a\n");
      const theirs = resource("notes/log.md", "a\ntheirs\n");
      mockResourceGetByPath
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(theirs);
      mockResourcePutIfSnapshot
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(written("notes/log.md", "a\ntheirs\nb\n"));

      await appendWorkspaceFile(user, "notes/log.md", "b\n");

      expect(mockResourcePutIfSnapshot).toHaveBeenCalledTimes(2);
      expect(mockResourcePutIfSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          previous: theirs,
          content: "a\ntheirs\nb\n",
        }),
      );
    });

    it("gives up without writing when the file keeps changing", async () => {
      mockResourceGetByPath.mockResolvedValue(resource("notes/log.md", "a"));
      mockResourcePutIfSnapshot.mockResolvedValue(null);

      await expect(
        appendWorkspaceFile(user, "notes/log.md", "b"),
      ).rejects.toThrow(/Nothing was appended/);
      expect(mockResourcePutIfSnapshot).toHaveBeenCalledTimes(5);
      expect(mockResourcePut).not.toHaveBeenCalled();
    });

    it("refuses an append that would pass the file size limit", async () => {
      mockResourceGetByPath.mockResolvedValue(
        resource("notes/log.md", "a".repeat(10 * 1024 * 1024)),
      );

      await expect(
        appendWorkspaceFile(user, "notes/log.md", "b"),
      ).rejects.toThrow(/per-file limit/);
      expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
    });

    it("appends onto an organization file from before organizations", async () => {
      const legacy = {
        ...resource("analysis/log.md", "old\n"),
        owner: "__shared__",
        metadata: JSON.stringify({
          source: "workspace-files",
          scope: "org",
          scopeId: "org_123",
        }),
        createdBy: "system",
        visibility: "agent_scratch",
      };
      mockResourceGetByPath.mockImplementation(async (owner: string) =>
        owner === "__shared__" ? legacy : null,
      );
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
      mockResourcePutIfSnapshot.mockResolvedValue(
        written("analysis/log.md", "old\nnew\n"),
      );

      await appendWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "analysis/log.md",
        "new\n",
      );

      expect(mockResourcePutIfSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          previous: null,
          owner: "__organization__:org_123",
          content: "old\nnew\n",
          options: expect.objectContaining({
            createdBy: "system",
            visibility: "agent_scratch",
          }),
        }),
      );
      expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(legacy);
    });

    it("takes its write back and reads again when the file from before organizations changed", async () => {
      const legacyWith = (content: string) => ({
        ...resource("analysis/log.md", content),
        owner: "__shared__",
        metadata: JSON.stringify({
          source: "workspace-files",
          scope: "org",
          scopeId: "org_123",
        }),
      });
      const before = legacyWith("old\n");
      const changed = legacyWith("changed\n");
      const legacyReads = [before, changed];
      mockResourceGetByPath.mockImplementation(async (owner: string) =>
        owner === "__shared__" ? (legacyReads.shift() ?? changed) : null,
      );
      mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);
      const first = written("analysis/log.md", "old\nnew\n");
      mockResourcePutIfSnapshot
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(written("analysis/log.md", "changed\nnew\n"));
      mockResourceDeleteIfCurrent
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await appendWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "analysis/log.md",
        "new\n",
      );

      expect(mockResourcePutIfSnapshot).toHaveBeenCalledTimes(2);
      expect(mockResourcePutIfSnapshot).toHaveBeenLastCalledWith(
        expect.objectContaining({
          previous: null,
          content: "changed\nnew\n",
        }),
      );
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(1, before);
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(
        2,
        first.resource,
      );
      expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(3, changed);
    });

    it("rejects organization appends from non-admin members", async () => {
      mockGetOrgRoleForEmail.mockResolvedValue("member");

      await expect(
        appendWorkspaceFile(
          { scope: "org", scopeId: "org_123" },
          "analysis/log.md",
          "new",
        ),
      ).rejects.toThrow(/owners and admins/);
      expect(mockResourcePutIfSnapshot).not.toHaveBeenCalled();
    });
  });

  it("reads resources with offset and maxChars", async () => {
    mockResourceGetByPath.mockResolvedValue(
      resource("scratch/data.txt", "abcdef"),
    );

    const file = await readWorkspaceFile(
      { scope: "user", scopeId: "alice@example.com" },
      "scratch/data.txt",
      { offset: 2, maxChars: 3 },
    );

    expect(file?.content).toBe("cde");
    expect(file?.contentType).toBe("text/plain");
    expect(file?.sizeBytes).toBe(6);
  });

  it("reads organization files from the active organization owner", async () => {
    mockResourceGetByPath.mockResolvedValue(resource("analysis/data.json"));

    await readWorkspaceFile(
      { scope: "org", scopeId: "org_123" },
      "analysis/data.json",
    );

    expect(mockResourceGetByPath).toHaveBeenCalledWith(
      "__organization__:org_123",
      "analysis/data.json",
      { orgId: "org_123" },
    );
  });

  it("reads legacy organization files from the shared owner", async () => {
    const legacy = {
      ...resource("analysis/legacy.json"),
      owner: "__shared__",
      metadata: JSON.stringify({
        source: "workspace-files",
        scope: "org",
        scopeId: "org_123",
      }),
    };
    mockResourceGetByPath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacy);
    mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);

    const file = await readWorkspaceFile(
      { scope: "org", scopeId: "org_123" },
      "analysis/legacy.json",
    );

    expect(file?.content).toBe("hello");
    expect(mockResourceGetByPath).toHaveBeenNthCalledWith(
      2,
      "__shared__",
      "analysis/legacy.json",
      { orgId: "org_123" },
    );
  });

  it("lists legacy organization files without overriding current files", async () => {
    const current = resource("analysis/current.md");
    const legacy = {
      ...resource("analysis/legacy.md"),
      owner: "__shared__",
    };
    mockResourceList
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([current, legacy]);
    mockIsLegacyOrganizationWorkspaceFile.mockImplementation(
      (resource: { owner: string }) => resource.owner === "__shared__",
    );

    const files = await listWorkspaceFiles(
      { scope: "org", scopeId: "org_123" },
      "analysis/",
    );

    expect(files.map((file) => file.path)).toEqual([
      "analysis/current.md",
      "analysis/legacy.md",
    ]);
  });

  it("lists exact prefix folders without prefix lookalikes", async () => {
    mockResourceList.mockResolvedValue([
      resource("analysis"),
      resource("analysis/a.md"),
      resource("analysis-extra/b.md"),
    ]);

    const files = await listWorkspaceFiles(
      { scope: "user", scopeId: "alice@example.com" },
      "analysis/",
    );

    expect(mockResourceList).toHaveBeenCalledWith(
      "alice@example.com",
      "analysis",
      { includeAgentScratch: true },
    );
    expect(files.map((file) => file.path)).toEqual([
      "analysis",
      "analysis/a.md",
    ]);
  });

  it("deletes by path in the resolved resource owner", async () => {
    const current = {
      ...resource("scratch/tmp.md"),
      owner: "__organization__:org_123",
    };
    mockResourceGetByPath.mockResolvedValue(current);

    await expect(
      deleteWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "scratch/tmp.md",
      ),
    ).resolves.toBe(true);
    expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(current);
  });

  it("deletes a resolved legacy organization file conditionally", async () => {
    const legacy = {
      ...resource("analysis/legacy.md"),
      owner: "__shared__",
      metadata: JSON.stringify({
        source: "workspace-files",
        scope: "org",
        scopeId: "org_123",
      }),
    };
    mockResourceGetByPath
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(legacy);
    mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);

    await expect(
      deleteWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "analysis/legacy.md",
      ),
    ).resolves.toBe(true);

    expect(mockResourceDeleteIfCurrent).toHaveBeenCalledWith(legacy);
    expect(mockResourceDeleteByPath).not.toHaveBeenCalled();
  });

  it("removes a legacy row when deleting an organization override", async () => {
    const current = {
      ...resource("scratch/tmp.md"),
      owner: "__organization__:org_123",
    };
    const legacy = {
      ...resource("scratch/tmp.md"),
      owner: "__shared__",
      metadata: JSON.stringify({
        source: "workspace-files",
        scope: "org",
        scopeId: "org_123",
      }),
    };
    mockResourceGetByPath
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(legacy);
    mockIsLegacyOrganizationWorkspaceFile.mockReturnValue(true);

    await expect(
      deleteWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "scratch/tmp.md",
      ),
    ).resolves.toBe(true);

    expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(1, current);
    expect(mockResourceDeleteIfCurrent).toHaveBeenNthCalledWith(2, legacy);
  });

  it("rejects organization deletes from non-admin members", async () => {
    mockGetOrgRoleForEmail.mockResolvedValue("member");

    await expect(
      deleteWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "analysis/summary.md",
      ),
    ).rejects.toThrow(
      "Only organization owners and admins can edit organization files",
    );
    expect(mockResourceDeleteByPath).not.toHaveBeenCalled();
  });

  it("rejects traversal paths", () => {
    expect(validatePath("../secret.md")).toContain("..");
    expect(validatePath("/absolute.md")).toContain("/");
  });
});

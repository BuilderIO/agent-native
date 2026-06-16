import { beforeEach, describe, expect, it, vi } from "vitest";

const mockResourcePut = vi.hoisted(() => vi.fn());
const mockResourceGetByPath = vi.hoisted(() => vi.fn());
const mockResourceList = vi.hoisted(() => vi.fn());
const mockResourceDeleteByPath = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "__shared__",
  resourcePut: mockResourcePut,
  resourceGetByPath: mockResourceGetByPath,
  resourceList: mockResourceList,
  resourceDeleteByPath: mockResourceDeleteByPath,
}));

import {
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
      "__shared__",
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
    mockResourceDeleteByPath.mockResolvedValue(true);

    await expect(
      deleteWorkspaceFile(
        { scope: "org", scopeId: "org_123" },
        "scratch/tmp.md",
      ),
    ).resolves.toBe(true);
    expect(mockResourceDeleteByPath).toHaveBeenCalledWith(
      "__shared__",
      "scratch/tmp.md",
    );
  });

  it("rejects traversal paths", () => {
    expect(validatePath("../secret.md")).toContain("..");
    expect(validatePath("/absolute.md")).toContain("/");
  });
});

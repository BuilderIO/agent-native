import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteWorkspaceFile = vi.hoisted(() => vi.fn());
const mockAppendWorkspaceFile = vi.hoisted(() => vi.fn());
const mockReadWorkspaceFile = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  writeWorkspaceFile: mockWriteWorkspaceFile,
  appendWorkspaceFile: mockAppendWorkspaceFile,
  readWorkspaceFile: mockReadWorkspaceFile,
  listWorkspaceFiles: vi.fn(),
  deleteWorkspaceFile: vi.fn(),
  grepWorkspaceFiles: vi.fn(),
}));

import { runWithRequestContext } from "../server/request-context.js";
import { createWorkspaceFilesTool } from "./tool.js";

const metadata = {
  id: "resource-csv",
  path: "exports/report.csv",
  contentType: "text/csv",
  sizeBytes: 42,
  createdAt: "2026-07-29T12:00:00.000Z",
  updatedAt: "2026-07-29T12:00:00.000Z",
};

function mockStoredContent(content: string) {
  mockReadWorkspaceFile.mockImplementation(
    async (
      _scope: unknown,
      _path: unknown,
      options?: { offset?: number; maxChars?: number },
    ) => {
      const offset = options?.offset ?? 0;
      const end =
        options?.maxChars === undefined ? undefined : offset + options.maxChars;
      return {
        ...metadata,
        scope: "user",
        scopeId: "alice@example.com",
        content: content.slice(offset, end),
      };
    },
  );
}

describe("workspace-files tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteWorkspaceFile.mockResolvedValue(metadata);
    mockAppendWorkspaceFile.mockResolvedValue(metadata);
  });

  it.each(["write", "append"] as const)(
    "returns download metadata after %s",
    async (action) => {
      const entry = createWorkspaceFilesTool()["workspace-files"];
      const result = await runWithRequestContext(
        { userEmail: "alice@example.com" },
        () =>
          entry!.run({
            action,
            path: metadata.path,
            content: "month,total\n2026-07,42",
            contentType: metadata.contentType,
          }),
      );

      expect(JSON.parse(String(result))).toEqual({
        ok: true,
        action,
        resourceId: metadata.id,
        path: metadata.path,
        contentType: metadata.contentType,
        sizeBytes: metadata.sizeBytes,
        updatedAt: metadata.updatedAt,
      });
    },
  );

  it("does not mark a file as truncated when it exactly fills the requested page", async () => {
    mockStoredContent("abcd");
    const entry = createWorkspaceFilesTool()["workspace-files"];

    const result = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () =>
        entry!.run({
          action: "read",
          path: metadata.path,
          maxChars: 4,
        }),
    );

    const parsed = JSON.parse(String(result));
    expect(parsed).toMatchObject({
      ok: true,
      content: "abcd",
    });
    expect(parsed).not.toHaveProperty("truncated");
  });

  it("returns only the requested page and a next offset when more content exists", async () => {
    mockStoredContent("abcde");
    const entry = createWorkspaceFilesTool()["workspace-files"];

    const result = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () =>
        entry!.run({
          action: "read",
          path: metadata.path,
          maxChars: 4,
        }),
    );

    expect(JSON.parse(String(result))).toMatchObject({
      ok: true,
      content: "abcd",
      truncated: true,
      nextOffset: 4,
    });
    expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
      expect.anything(),
      metadata.path,
      { offset: 0, maxChars: 5 },
    );
  });

  it("normalizes fractional paging values to advancing integer boundaries", async () => {
    mockStoredContent("abcdef");
    const entry = createWorkspaceFilesTool()["workspace-files"];

    expect(entry!.tool.parameters?.properties).toMatchObject({
      offset: { type: "integer" },
      maxChars: { type: "integer" },
    });

    const result = await runWithRequestContext(
      { userEmail: "alice@example.com" },
      () =>
        entry!.run({
          action: "read",
          path: metadata.path,
          offset: 1.9,
          maxChars: 0.5,
        }),
    );

    expect(JSON.parse(String(result))).toMatchObject({
      ok: true,
      content: "b",
      truncated: true,
      nextOffset: 2,
    });
    expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
      expect.anything(),
      metadata.path,
      { offset: 1, maxChars: 2 },
    );
  });
});

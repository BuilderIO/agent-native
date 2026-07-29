import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteWorkspaceFile = vi.hoisted(() => vi.fn());
const mockAppendWorkspaceFile = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  writeWorkspaceFile: mockWriteWorkspaceFile,
  appendWorkspaceFile: mockAppendWorkspaceFile,
  readWorkspaceFile: vi.fn(),
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
});

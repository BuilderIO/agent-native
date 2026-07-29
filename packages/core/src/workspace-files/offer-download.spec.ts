import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetWorkspaceFileMeta = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());
const mockGetRequestUserEmail = vi.hoisted(() => vi.fn());

vi.mock("./store.js", () => ({
  getWorkspaceFileMeta: mockGetWorkspaceFileMeta,
}));

vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: mockGetRequestOrgId,
  getRequestUserEmail: mockGetRequestUserEmail,
}));

import {
  contentDispositionAttachment,
  resourceDownloadFilename,
} from "../resources/handlers.js";
import {
  createOfferDownloadTool,
  downloadFilenameFromPath,
  workspaceDownloadUrl,
} from "./offer-download.js";

describe("downloadFilenameFromPath", () => {
  it("takes the last path segment", () => {
    expect(downloadFilenameFromPath("exports/agent-credits.csv")).toBe(
      "agent-credits.csv",
    );
  });

  it("falls back rather than producing an empty filename", () => {
    expect(downloadFilenameFromPath("exports/")).toBe("exports");
    expect(downloadFilenameFromPath("")).toBe("download");
  });
});

describe("workspaceDownloadUrl", () => {
  it("points at the raw resource route with the download flag", () => {
    expect(workspaceDownloadUrl("res_123")).toBe(
      "/_agent-native/resources/res_123?download",
    );
  });

  it("encodes ids so a crafted id cannot alter the query", () => {
    expect(workspaceDownloadUrl("a/b?c")).toBe(
      "/_agent-native/resources/a%2Fb%3Fc?download",
    );
  });
});

describe("contentDispositionAttachment", () => {
  it("marks the response as an attachment with the filename", () => {
    expect(contentDispositionAttachment("report.csv")).toBe(
      `attachment; filename="report.csv"; filename*=UTF-8''report.csv`,
    );
  });

  it("neutralizes quotes and backslashes so the header cannot be split", () => {
    const value = contentDispositionAttachment('a"b\\c.csv');
    expect(value).toContain('filename="a_b_c.csv"');
  });

  it("keeps non-ASCII names readable through the RFC 5987 form", () => {
    const value = contentDispositionAttachment("rapport-é.csv");
    expect(value).toContain('filename="rapport-_.csv"');
    expect(value).toContain("filename*=UTF-8''rapport-%C3%A9.csv");
  });
});

describe("resourceDownloadFilename", () => {
  it("handles a missing path", () => {
    expect(resourceDownloadFilename(undefined)).toBe("download");
  });
});

describe("offer-download action", () => {
  const run = () => createOfferDownloadTool()["offer-download"]!.run;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestOrgId.mockReturnValue(undefined);
    mockGetRequestUserEmail.mockReturnValue("dev@local.test");
  });

  it("resolves a workspace path to a download card payload", async () => {
    mockGetWorkspaceFileMeta.mockResolvedValue({
      id: "res-1",
      path: "exports/credits.csv",
      contentType: "text/csv",
      sizeBytes: 28,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    const result = (await run()({
      path: "exports/credits.csv",
      label: "Agent credits",
    })) as Record<string, unknown>;

    expect(result).toMatchObject({
      filename: "credits.csv",
      url: "/_agent-native/resources/res-1?download",
      contentType: "text/csv",
      sizeBytes: 28,
      label: "Agent credits",
    });
  });

  it("fails loudly when the file does not exist rather than returning a dead card", async () => {
    mockGetWorkspaceFileMeta.mockResolvedValue(null);
    await expect(run()({ path: "exports/missing.csv" })).rejects.toThrow(
      /No workspace file at/,
    );
  });

  it("fails when there is no authenticated scope", async () => {
    mockGetRequestUserEmail.mockReturnValue(undefined);
    await expect(run()({ path: "exports/credits.csv" })).rejects.toThrow(
      /authenticated request context/,
    );
  });

  it("prefers org scope when the request carries one", async () => {
    mockGetRequestOrgId.mockReturnValue("org_9");
    mockGetWorkspaceFileMeta.mockResolvedValue({
      id: "res-2",
      path: "exports/credits.csv",
      contentType: "text/csv",
      sizeBytes: 10,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    await run()({ path: "exports/credits.csv" });

    expect(mockGetWorkspaceFileMeta).toHaveBeenCalledWith(
      { scope: "org", scopeId: "org_9" },
      "exports/credits.csv",
    );
  });
});

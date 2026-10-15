import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRecordingRun: vi.fn(),
  createRecordingUploadTicket: vi.fn(),
  getRequestContext: vi.fn(),
  releaseRecordingUploadTicket: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: () => "https://clips.production.example",
  getRequestContext: mocks.getRequestContext,
}));

vi.mock("../server/lib/public-agent-context.js", () => ({
  getServerAppBasePath: () => "",
}));

vi.mock("../server/lib/recording-upload-ticket.js", () => ({
  createRecordingUploadTicket: mocks.createRecordingUploadTicket,
  releaseRecordingUploadTicket: mocks.releaseRecordingUploadTicket,
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: () => "owner@example.com",
  nanoid: () => "rec-1",
}));

vi.mock("./create-recording.js", () => ({
  default: { run: mocks.createRecordingRun },
}));

import action from "./create-recording-upload";

const MIB = 1024 * 1024;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestContext.mockReturnValue({
    requestOrigin: "https://clips.example",
  });
  mocks.createRecordingRun.mockResolvedValue({
    id: "rec-1",
    organizationId: "org-1",
    status: "uploading",
    uploadChunkUrl: "/api/uploads/rec-1/chunk",
    uploadMode: "streaming",
  });
  mocks.createRecordingUploadTicket.mockResolvedValue({
    recordingId: "rec-1",
    tokenHash: "hash",
    token: "fake-ticket",
    expiresAt: Date.parse("2026-10-14T14:00:00.000Z"),
  });
});

describe("create-recording-upload", () => {
  it("creates the recording at the chosen visibility and returns a ticketed chunk upload", async () => {
    const actionContext = { caller: "mcp", userEmail: "owner@example.com" };
    const result = await (action as any).run(
      {
        title: "PR 7419 chart fixes",
        visibility: "private",
        mimeType: "video/mp4",
        sizeBytes: 7 * MIB,
        durationMs: 189_000,
        width: 1920,
        height: 1080,
      },
      actionContext,
    );

    expect(mocks.createRecordingRun).toHaveBeenCalledWith(
      {
        id: "rec-1",
        title: "PR 7419 chart fixes",
        visibility: "private",
        mimeType: "video/mp4",
        width: 1920,
        height: 1080,
        hasAudio: true,
        hasCamera: false,
        recordingSource: "agent_upload",
        requestStreaming: true,
      },
      actionContext,
    );
    expect(mocks.createRecordingUploadTicket).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
    );
    expect(
      mocks.createRecordingUploadTicket.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.createRecordingRun.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({
      recordingId: "rec-1",
      visibility: "private",
      shareUrl: "https://clips.example/share/rec-1",
      method: "POST",
      headers: {
        Authorization: "Bearer fake-ticket",
        "Content-Type": "video/mp4",
      },
      chunkSizeBytes: 3 * MIB,
      totalChunks: 3,
      expiresAt: "2026-10-14T14:00:00.000Z",
    });
    const chunkUrl = new URL(result.chunkUrl);
    expect(chunkUrl.origin + chunkUrl.pathname).toBe(
      "https://clips.example/api/uploads/rec-1/agent-chunk",
    );
    expect(Object.fromEntries(chunkUrl.searchParams)).toEqual({
      mimeType: "video/mp4",
      total: "3",
      hasAudio: "1",
      hasCamera: "0",
      durationMs: "189000",
      width: "1920",
      height: "1080",
    });
    expect(result.next).toContain("isFinal=1");
  });

  it("creates no recording when the ticket is refused or cannot be saved", async () => {
    mocks.createRecordingUploadTicket.mockRejectedValue(
      Object.assign(new Error("20 agent uploads are still in progress."), {
        statusCode: 429,
      }),
    );

    await expect(
      (action as any).run(
        { visibility: "org", mimeType: "video/mp4", sizeBytes: MIB },
        { caller: "mcp", userEmail: "owner@example.com" },
      ),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.createRecordingRun).not.toHaveBeenCalled();
  });

  it("releases the reserved ticket when creating the recording fails", async () => {
    const failure = new Error("storage is not configured");
    mocks.createRecordingRun.mockRejectedValue(failure);
    mocks.releaseRecordingUploadTicket.mockRejectedValue(new Error("busy"));

    await expect(
      (action as any).run(
        { visibility: "org", mimeType: "video/mp4", sizeBytes: MIB },
        { caller: "mcp", userEmail: "owner@example.com" },
      ),
    ).rejects.toBe(failure);
    expect(mocks.releaseRecordingUploadTicket).toHaveBeenCalledWith(
      "owner@example.com",
      "rec-1",
    );
  });

  it("refuses files over the upload limit before creating a recording", () => {
    const parsed = (action as any).schema.safeParse({
      visibility: "org",
      mimeType: "video/mp4",
      sizeBytes: 2 * 1024 * MIB + 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires an explicit visibility and a supported video type", () => {
    const schema = (action as any).schema;
    expect(
      schema.safeParse({ mimeType: "video/mp4", sizeBytes: MIB }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        visibility: "public",
        mimeType: "video/x-matroska",
        sizeBytes: MIB,
      }).success,
    ).toBe(false);
  });

  it("is listed in the compact MCP catalog without switching Clips to the connector tier", () => {
    expect((action as any).mcpApp).toEqual({ compactCatalog: true });
    expect((action as any).mcpTool).toBeUndefined();
  });
});

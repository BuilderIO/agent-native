import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAttachment: vi.fn(),
  getActivePrivateBlobProviderForRequest: vi.fn(),
  getSessionReplaySummary: vi.fn(),
  invokeAgent: vi.fn(),
  invokeAgentAction: vi.fn(),
  mintAttachmentRef: vi.fn(),
  readMultipartFormData: vi.fn(),
  resolveA2ACallerAuth: vi.fn(),
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    readMultipartFormData: (...args: unknown[]) =>
      mocks.readMultipartFormData(...args),
  };
});

vi.mock("@agent-native/core/a2a", () => ({
  invokeAgent: mocks.invokeAgent,
  invokeAgentAction: mocks.invokeAgentAction,
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
}));

vi.mock("@agent-native/core/private-blob", () => ({
  ATTACHMENT_REF_MAX_CHARS: 2_048,
  deleteAttachment: mocks.deleteAttachment,
  getActivePrivateBlobProviderForRequest:
    mocks.getActivePrivateBlobProviderForRequest,
  isPrivateBlobError: () => false,
  mintAttachmentRef: mocks.mintAttachmentRef,
}));

vi.mock("../../../lib/credentials", () => ({
  runApiHandlerWithContext: (
    _event: unknown,
    handler: (context: unknown) => unknown,
  ) => handler({ userEmail: "ada@example.test", orgId: "org-1" }),
}));

vi.mock("../../../lib/session-replay", () => ({
  getSessionReplaySummary: mocks.getSessionReplaySummary,
}));

import handler from "./storyboard.post";

const boundary = "replay-storyboard-test-boundary";
const designId = "design-123";
const designUrl = "https://design.example.test";
let confirmationBoardContent: string;
const screenshot = {
  recordingId: "sr_123",
  offsetMs: 1_250,
  route: "/library?return=%2Fhome",
  viewportWidth: 2,
  viewportHeight: 1,
  eventCount: 3,
  capturedAt: "2026-10-07T12:00:00.000Z",
};

function pngBytes(): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(screenshot.viewportWidth, 16);
  bytes.writeUInt32BE(screenshot.viewportHeight, 20);
  return bytes;
}

function multipartBody(): Buffer {
  const manifest = {
    designId,
    cohortTotal: 1,
    selectedReplayCount: 1,
    screenshots: [screenshot],
  };
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\n\r\n${JSON.stringify(manifest)}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="screenshot-0"; filename="replay.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    pngBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function makeEvent(body: Uint8Array, contentLength?: string) {
  return {
    req: new Request(
      "http://analytics.example.test/api/session-replay/storyboard",
      {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          ...(contentLength ? { "content-length": contentLength } : {}),
        },
        body: body as BodyInit,
      },
    ),
  };
}

function designOutput(boardContent?: string): string {
  return JSON.stringify({
    id: designId,
    files: [
      {
        id: "board-file-123",
        filename: "__board__.html",
        fileType: "html",
        ...(boardContent === undefined ? {} : { content: boardContent }),
      },
    ],
  });
}

function matchingBoardContent(): string {
  return `<img src="/api/design-board-replay-screenshots/screenshot_123" data-session-replay-id="${screenshot.recordingId}" data-session-replay-captured-at="${screenshot.capturedAt}" data-session-replay-app="clips" data-session-replay-route="${screenshot.route}" data-session-replay-offset-ms="${screenshot.offsetMs}" data-session-replay-event-count="${screenshot.eventCount}" width="${screenshot.viewportWidth}" height="${screenshot.viewportHeight}" />`;
}

describe("POST /api/session-replay/storyboard", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    confirmationBoardContent = matchingBoardContent();
    mocks.getActivePrivateBlobProviderForRequest.mockResolvedValue({
      id: "private-provider",
    });
    mocks.getSessionReplaySummary.mockResolvedValue({
      id: screenshot.recordingId,
      app: "clips",
      durationMs: 10_000,
      eventCount: screenshot.eventCount,
    });
    mocks.mintAttachmentRef.mockResolvedValue({
      status: "ok",
      ref: "private-attachment-ref",
      handle: { provider: "private-provider", opaque: true },
    });
    mocks.deleteAttachment.mockResolvedValue({ status: "ok", deleted: true });
    mocks.resolveA2ACallerAuth.mockResolvedValue({ apiKey: "test-a2a-token" });
    mocks.invokeAgent.mockResolvedValue({
      target: { url: designUrl },
      responseText: "Design saved.",
    });
    mocks.invokeAgentAction.mockImplementation(async () => {
      const callIndex = mocks.invokeAgentAction.mock.calls.length;
      const input =
        mocks.invokeAgentAction.mock.calls[
          mocks.invokeAgentAction.mock.calls.length - 1
        ]?.[0]?.input;
      const boardContent =
        input?.includeFileContent === false
          ? undefined
          : callIndex === 2
            ? ""
            : confirmationBoardContent;
      return {
        target: { url: designUrl },
        result: {
          action: "get-design",
          status: "completed",
          output: designOutput(boardContent),
        },
      };
    });
    mocks.readMultipartFormData.mockImplementation(async (event: any) => {
      const form = await event.req.formData();
      return Promise.all(
        [...form.entries()].map(async ([name, value]) =>
          typeof value === "string"
            ? { name, data: Buffer.from(value) }
            : {
                name,
                type: value.type,
                filename: value.name,
                data: Buffer.from(await value.arrayBuffer()),
              },
        ),
      );
    });
  });

  it("confirms the Design write from structured board data, not the agent reply URL", async () => {
    const result = await (handler as any)(makeEvent(multipartBody()));

    expect(result.screenshotCount).toBe(1);
    expect(result.cleanupPending).toBe(false);
    expect(new URL(result.boardUrl).searchParams.get("designId")).toBe(
      designId,
    );
    expect(mocks.invokeAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "get-design",
        input: expect.objectContaining({ id: designId }),
      }),
    );
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(4);
  });

  it("reports a timed-out mutation as successful only when read-back proves the write", async () => {
    mocks.invokeAgent.mockRejectedValue(new Error("request timed out"));

    const result = await (handler as any)(makeEvent(multipartBody()));

    expect(result.screenshotCount).toBe(1);
    expect(result.cleanupPending).toBe(false);
  });

  it("reports an ambiguous timed-out mutation when read-back cannot prove the write", async () => {
    mocks.invokeAgent.mockRejectedValue(new Error("request timed out"));
    confirmationBoardContent = "";

    await expect(
      (handler as any)(makeEvent(multipartBody())),
    ).rejects.toMatchObject({
      status: 502,
      statusText: expect.stringContaining("check Design before retrying"),
    });
  });

  it("rejects an oversized streamed body even when Content-Length understates it", async () => {
    const overLimit = new Uint8Array(20 * 1024 * 1024 + 96_001);

    await expect(
      (handler as any)(makeEvent(overLimit, "1")),
    ).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("does not report cleanup as complete when the provider keeps the attachment", async () => {
    mocks.deleteAttachment.mockResolvedValue({ status: "ok", deleted: false });

    const result = await (handler as any)(makeEvent(multipartBody()));

    expect(result.cleanupPending).toBe(true);
  });
});

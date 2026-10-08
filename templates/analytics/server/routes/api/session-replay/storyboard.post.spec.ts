import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSessionReplaySummary: vi.fn(),
  invokeAgentAction: vi.fn(),
  readMultipartFormData: vi.fn(),
  resolveA2ACallerAuth: vi.fn(),
  resolveAgentInvocationTarget: vi.fn(),
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
  invokeAgentAction: mocks.invokeAgentAction,
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
  resolveAgentInvocationTarget: mocks.resolveAgentInvocationTarget,
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

const designId = "design-123";
const designUrl = "https://design.example.test";
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

function makeFormData() {
  const form = new FormData();
  form.set(
    "manifest",
    JSON.stringify({
      designId,
      cohortTotal: 1,
      selectedReplayCount: 1,
      screenshots: [screenshot],
    }),
  );
  form.append(
    "screenshot-0",
    new Blob([new Uint8Array(pngBytes()).buffer as ArrayBuffer], {
      type: "image/png",
    }),
    "replay.png",
  );
  return form;
}

function makeEvent(body: BodyInit) {
  return {
    req: new Request(
      "http://analytics.example.test/api/session-replay/storyboard",
      { method: "POST", body },
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
  return `<img src="/api/design-board-replay-screenshots/screenshot_123" data-session-replay-id="${screenshot.recordingId}" data-session-replay-captured-at="${screenshot.capturedAt}" data-session-replay-app="clips" data-session-replay-route="${screenshot.route}" data-session-replay-offset-ms="${screenshot.offsetMs}" data-session-replay-event-count="${screenshot.eventCount}" data-session-replay-viewport-width="${screenshot.viewportWidth}" data-session-replay-viewport-height="${screenshot.viewportHeight}" />`;
}

describe("POST /api/session-replay/storyboard", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getSessionReplaySummary.mockResolvedValue({
      id: screenshot.recordingId,
      app: "clips",
      durationMs: 10_000,
      eventCount: screenshot.eventCount,
    });
    mocks.resolveAgentInvocationTarget.mockResolvedValue({ url: designUrl });
    mocks.resolveA2ACallerAuth.mockResolvedValue({ apiKey: "test-a2a-token" });
    mocks.invokeAgentAction.mockImplementation(async ({ input }: any) => {
      const callIndex = mocks.invokeAgentAction.mock.calls.length;
      const content =
        input?.includeFileContent === false
          ? undefined
          : callIndex === 2
            ? ""
            : matchingBoardContent();
      return {
        target: { url: designUrl },
        result: {
          action: "get-design",
          status: "completed",
          output: designOutput(content),
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
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(url).toBe(`${designUrl}/api/session-replay-storyboard`);
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer test-a2a-token",
      );
      expect(form.get("manifest")).toContain('"replayId":"sr_123"');
      expect(form.get("screenshot-0")).toBeInstanceOf(Blob);
      return Response.json({
        response: "Added one screenshot.",
        boardUrl: "https://design.example.test/design/design-123",
        designId,
        screenshotCount: 1,
      });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads validated replay pixels directly to Design without Analytics blob storage", async () => {
    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result.screenshotCount).toBe(1);
    expect(result.cleanupPending).toBe(false);
    expect(result.response).toBe("Added one screenshot.");
    expect(new URL(result.boardUrl).searchParams.get("designId")).toBe(
      designId,
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(4);
  });

  it("shows the Design storage error instead of masking it with a boolean", async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json(
        {
          error: true,
          statusMessage: "Design private screenshot storage is unavailable",
        },
        { status: 503 },
      ),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Design private screenshot storage is unavailable",
    });
  });

  it("does not report an ambiguous save as complete when read-back misses the new image", async () => {
    mocks.invokeAgentAction.mockImplementation(async () => ({
      target: { url: designUrl },
      result: {
        action: "get-design",
        status: "completed",
        output: designOutput(""),
      },
    }));

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: expect.stringContaining("check Design before retrying"),
    });
  });

  it("rejects an oversized streamed body before parsing or handing off", async () => {
    const overLimit = new Uint8Array(20 * 1024 * 1024 + 96_001);

    await expect((handler as any)(makeEvent(overLimit))).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

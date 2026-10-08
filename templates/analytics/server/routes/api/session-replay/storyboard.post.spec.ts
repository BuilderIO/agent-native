import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCredentialedA2AUrl: vi.fn(),
  canonicalA2AAudience: vi.fn(),
  getSessionReplaySummary: vi.fn(),
  invokeAgentAction: vi.fn(),
  readMultipartFormData: vi.fn(),
  resolveA2ACallerAuth: vi.fn(),
  resolveAgentInvocationTarget: vi.fn(),
  resolveVercelDeploymentProtectionHeaders: vi.fn(),
  ssrfSafeFetch: vi.fn(),
  workspacePrivateOrigins: vi.fn(),
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
  assertCredentialedA2AUrl: mocks.assertCredentialedA2AUrl,
  canonicalA2AAudience: mocks.canonicalA2AAudience,
  invokeAgentAction: mocks.invokeAgentAction,
  resolveA2ACallerAuth: mocks.resolveA2ACallerAuth,
  resolveAgentInvocationTarget: mocks.resolveAgentInvocationTarget,
  workspacePrivateOrigins: mocks.workspacePrivateOrigins,
}));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mocks.ssrfSafeFetch,
}));

vi.mock("@agent-native/core/server", () => ({
  resolveVercelDeploymentProtectionHeaders:
    mocks.resolveVercelDeploymentProtectionHeaders,
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

function pngBytes(
  width = screenshot.viewportWidth,
  height = screenshot.viewportHeight,
): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function makeFormData({
  screenshots = [screenshot],
  pixelWidthOverride,
}: {
  screenshots?: Array<typeof screenshot>;
  pixelWidthOverride?: number;
} = {}) {
  const form = new FormData();
  const replayCount = new Set(screenshots.map(({ recordingId }) => recordingId))
    .size;
  form.set(
    "manifest",
    JSON.stringify({
      designId,
      cohortTotal: replayCount,
      selectedReplayCount: replayCount,
      screenshots,
    }),
  );
  screenshots.forEach((shot, index) => {
    form.append(
      `screenshot-${index}`,
      new Blob(
        [
          new Uint8Array(
            pngBytes(
              pixelWidthOverride ?? shot.viewportWidth,
              shot.viewportHeight,
            ),
          ).buffer as ArrayBuffer,
        ],
        {
          type: "image/png",
        },
      ),
      `replay-${index}.png`,
    );
  });
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
    mocks.canonicalA2AAudience.mockReturnValue(designUrl);
    mocks.workspacePrivateOrigins.mockReturnValue(["http://127.0.0.1:3000"]);
    mocks.resolveVercelDeploymentProtectionHeaders.mockReturnValue({
      "x-test-deployment-protection": "enabled",
    });
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
    mocks.ssrfSafeFetch.mockImplementation(
      async (url: string, init: RequestInit) => {
        const form = init.body as FormData;
        expect(url).toBe(`${designUrl}/api/session-replay-storyboard`);
        expect(new Headers(init.headers).get("authorization")).toMatch(
          /^Bearer /,
        );
        expect(
          new Headers(init.headers).get("x-test-deployment-protection"),
        ).toBe("enabled");
        expect(form.get("manifest")).toContain('"replayId":"sr_123"');
        expect(form.get("screenshot-0")).toBeInstanceOf(Blob);
        return Response.json({
          response: "Added one screenshot.",
          boardUrl: "https://design.example.test/design/design-123",
          designId,
          screenshotCount: 1,
        });
      },
    );
  });

  it("uploads validated replay pixels through the SSRF-safe Design request", async () => {
    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result.screenshotCount).toBe(1);
    expect(result.cleanupPending).toBe(false);
    expect(result.response).toBe("Added one screenshot.");
    expect(new URL(result.boardUrl).searchParams.get("designId")).toBe(
      designId,
    );
    expect(mocks.assertCredentialedA2AUrl).toHaveBeenCalledWith(
      `${designUrl}/api/session-replay-storyboard`,
      true,
    );
    expect(mocks.resolveVercelDeploymentProtectionHeaders).toHaveBeenCalledWith(
      `${designUrl}/api/session-replay-storyboard`,
    );
    expect(
      new Headers(mocks.ssrfSafeFetch.mock.calls[0][1].headers).get(
        "authorization",
      ),
    ).toBe("Bearer test-a2a-token");
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(1);
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledWith(
      `${designUrl}/api/session-replay-storyboard`,
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
      {
        allowedPrivateOrigins: ["http://127.0.0.1:3000"],
        followRedirects: false,
        maxRedirects: 0,
        requireDispatcher: true,
      },
    );
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(4);
  });

  it("canonicalizes the Design audience before minting the upload token", async () => {
    mocks.resolveAgentInvocationTarget.mockResolvedValueOnce({
      url: `${designUrl}/`,
    });

    await (handler as any)(makeEvent(makeFormData()));

    expect(mocks.canonicalA2AAudience).toHaveBeenCalledWith(`${designUrl}/`);
    expect(mocks.resolveA2ACallerAuth).toHaveBeenCalledWith({
      audience: designUrl,
    });
  });

  it("rejects a screenshot batch above the decoded pixel limit before replay lookups", async () => {
    const screenshots = Array.from({ length: 5 }, (_, index) => ({
      ...screenshot,
      recordingId: `sr_${index}`,
      viewportWidth: 4_000,
      viewportHeight: 2_000,
    }));

    await expect(
      (handler as any)(makeEvent(makeFormData({ screenshots }))),
    ).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: "Screenshot batch exceeds the decoded pixel limit",
    });
    expect(mocks.getSessionReplaySummary).not.toHaveBeenCalled();
    expect(mocks.resolveAgentInvocationTarget).not.toHaveBeenCalled();
  });

  it("shows the Design storage error instead of masking it with a boolean", async () => {
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
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
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      Response.json({
        response: "Added one screenshot.",
        boardUrl: "https://design.example.test/design/design-123",
        designId,
        screenshotCount: 1,
        cleanupPending: true,
      }),
    );
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
      data: { cleanupPending: true },
    });
  });

  it("rejects an oversized streamed body before parsing or handing off", async () => {
    const overLimit = new Uint8Array(20 * 1024 * 1024 + 96_001);

    await expect((handler as any)(makeEvent(overLimit))).rejects.toMatchObject({
      statusCode: 413,
    });
    expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("returns a gateway timeout when the Design upload exceeds its deadline", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.ssrfSafeFetch.mockImplementation(() => {
      markStarted();
      return new Promise(() => {});
    });
    vi.useFakeTimers();
    try {
      const pending = (handler as any)(makeEvent(makeFormData()));
      const rejected = expect(pending).rejects.toMatchObject({
        statusCode: 504,
        statusMessage:
          "Design screenshot upload timed out. It may have saved the storyboard; check Design before retrying.",
        data: { saveOutcomeUnknown: true },
      });
      await started;
      await vi.advanceTimersByTimeAsync(240_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("tries the fallback token without reading a rejected response body", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValueOnce({
      apiKey: "test-a2a-token",
      apiKeyFallbacks: ["fallback-a2a-token"],
    });
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      new Response(new Uint8Array(64_001), { status: 401 }),
    );

    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result.screenshotCount).toBe(1);
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(
      new Headers(mocks.ssrfSafeFetch.mock.calls[0][1].headers).get(
        "authorization",
      ),
    ).toBe("Bearer test-a2a-token");
    expect(
      new Headers(mocks.ssrfSafeFetch.mock.calls[1][1].headers).get(
        "authorization",
      ),
    ).toBe("Bearer fallback-a2a-token");
  });

  it("keeps the upload deadline active while reading the Design response body", async () => {
    let markBodyRead!: () => void;
    const bodyRead = new Promise<void>((resolve) => {
      markBodyRead = resolve;
    });
    const response = {
      status: 200,
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            markBodyRead();
            return new Promise(() => {});
          },
          cancel: vi.fn().mockResolvedValue(undefined),
          releaseLock: vi.fn(),
        }),
      },
    } as unknown as Response;
    mocks.ssrfSafeFetch.mockResolvedValueOnce(response);
    vi.useFakeTimers();
    try {
      const pending = (handler as any)(makeEvent(makeFormData()));
      const rejected = expect(pending).rejects.toMatchObject({
        statusCode: 504,
        statusMessage:
          "Design screenshot upload timed out. It may have saved the storyboard; check Design before retrying.",
        data: { saveOutcomeUnknown: true },
      });
      await bodyRead;
      await vi.advanceTimersByTimeAsync(240_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects oversized Design upload responses before buffering the full body", async () => {
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      new Response(new Uint8Array(64_001)),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: "Design screenshot upload response was too large",
    });
  });

  it("propagates pending temporary-blob cleanup with the Design error", async () => {
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      Response.json(
        {
          statusMessage: "The Design action failed",
          data: {
            action: "add-session-replay-screenshots-to-board",
            cleanupPending: true,
          },
        },
        { status: 409 },
      ),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: "The Design action failed",
      data: {
        action: "add-session-replay-screenshots-to-board",
        cleanupPending: true,
      },
    });
  });
});

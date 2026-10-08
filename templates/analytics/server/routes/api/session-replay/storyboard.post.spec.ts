import { deflateSync } from "node:zlib";

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

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.byteLength)),
    8 + data.byteLength,
  );
  return chunk;
}

function pngBytes(
  requestedWidth = screenshot.viewportWidth,
  requestedHeight = screenshot.viewportHeight,
): Buffer {
  // The oversized manifest test fails before inspecting image dimensions.
  const width = requestedWidth * requestedHeight > 10_000 ? 1 : requestedWidth;
  const height =
    requestedWidth * requestedHeight > 10_000 ? 1 : requestedHeight;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function corruptPngData(): Buffer {
  const bytes = pngBytes();
  const idatOffset = 8 + 25;
  const dataLength = bytes.readUInt32BE(idatOffset);
  const dataOffset = idatOffset + 8;
  bytes[dataOffset + dataLength - 1] ^= 0xff;
  bytes.writeUInt32BE(
    crc32(bytes.subarray(idatOffset + 4, dataOffset + dataLength)),
    dataOffset + dataLength,
  );
  return bytes;
}

function pngWithInvalidPaletteIndex(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 3;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("PLTE", Buffer.from([0, 0, 0])),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 1]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeFormData({
  screenshots = [screenshot],
  pixelWidthOverride,
  pngOverride,
}: {
  screenshots?: Array<typeof screenshot>;
  pixelWidthOverride?: number;
  pngOverride?: Buffer;
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
            pngOverride ??
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
    mocks.resolveA2ACallerAuth.mockResolvedValue({
      apiKey: "test-a2a-token",
      userEmail: "alice@example.test",
    });
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
    for (const [options] of mocks.invokeAgentAction.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({
          target: designUrl,
          apiKey: "test-a2a-token",
          userEmail: "ada@example.test",
        }),
      );
      expect(options).not.toHaveProperty("orgDomain");
      expect(options).not.toHaveProperty("orgSecret");
    }
    expect(mocks.invokeAgentAction).toHaveBeenCalledTimes(4);
  });

  it("shares one deadline across existing-board reads, upload, and confirmation", async () => {
    const start = Date.now();
    let elapsed = 0;
    const dateNow = vi
      .spyOn(Date, "now")
      .mockImplementation(() => start + elapsed);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const uploadImplementation = mocks.ssrfSafeFetch.getMockImplementation();
    mocks.invokeAgentAction.mockImplementation(async ({ input }: any) => {
      const callIndex = mocks.invokeAgentAction.mock.calls.length;
      if (callIndex <= 2) elapsed += 20_000;
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
    mocks.ssrfSafeFetch.mockImplementation(async (...args: any[]) => {
      elapsed += 5_000;
      return uploadImplementation!(...args);
    });

    try {
      await (handler as any)(makeEvent(makeFormData()));

      expect(
        mocks.invokeAgentAction.mock.calls.map(
          ([options]) => options.requestTimeoutMs,
        ),
      ).toEqual([30_000, 30_000, 15_000, 15_000]);
      expect(
        setTimeoutSpy.mock.calls.some(([, timeoutMs]) => timeoutMs === 20_000),
      ).toBe(true);
    } finally {
      dateNow.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  });

  it("canonicalizes the Design audience before minting the upload token", async () => {
    mocks.resolveAgentInvocationTarget.mockResolvedValueOnce({
      url: `${designUrl}/`,
    });

    await (handler as any)(makeEvent(makeFormData()));

    expect(mocks.canonicalA2AAudience).toHaveBeenCalledWith(`${designUrl}/`);
    expect(mocks.resolveA2ACallerAuth).toHaveBeenCalledWith({
      audience: designUrl,
      userIdentityOnly: true,
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

  it.each([
    ["a header-only PNG", pngBytes().subarray(0, 33)],
    ["corrupt compressed pixels", corruptPngData()],
    ["an out-of-range indexed palette pixel", pngWithInvalidPaletteIndex()],
  ])("rejects %s before handing it to Design", async (_label, pngOverride) => {
    await expect(
      (handler as any)(makeEvent(makeFormData({ pngOverride }))),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: "Screenshot pixels do not match the replay viewport",
    });
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
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

  it("times out and cancels a stalled multipart request stream", async () => {
    let markRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markRead = resolve;
    });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull() {
        markRead();
        return new Promise(() => {});
      },
      cancel,
    });
    const event = {
      req: new Request(
        "http://analytics.example.test/api/session-replay/storyboard",
        { method: "POST", body, duplex: "half" } as RequestInit & {
          duplex: "half";
        },
      ),
    };
    vi.useFakeTimers();
    try {
      const pending = (handler as any)(event);
      const rejected = expect(pending).rejects.toMatchObject({
        statusCode: 504,
        statusMessage:
          "Screenshot export request exceeded its request deadline",
      });
      await readStarted;
      await vi.advanceTimersByTimeAsync(60_000);
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds sequential replay-summary preflight by the shared deadline", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.getSessionReplaySummary.mockImplementationOnce(() => {
      markStarted();
      return new Promise(() => {});
    });
    vi.useFakeTimers();
    try {
      const pending = (handler as any)(makeEvent(makeFormData()));
      const rejected = expect(pending).rejects.toMatchObject({
        statusCode: 504,
        statusMessage:
          "Screenshot export request exceeded its request deadline",
      });
      await started;
      await vi.advanceTimersByTimeAsync(60_000);
      await rejected;
      expect(mocks.resolveAgentInvocationTarget).not.toHaveBeenCalled();
      expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
      await vi.advanceTimersByTimeAsync(60_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a transport error as an unknown save outcome after upload dispatch", async () => {
    mocks.ssrfSafeFetch.mockRejectedValueOnce(
      new TypeError("connection reset"),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: expect.stringContaining("Check Design before retrying"),
      data: { saveOutcomeUnknown: true },
    });
  });

  it.each([
    "SSRF blocked: refusing to fetch private/internal address",
    "SSRF protection is unavailable because the server dispatcher could not be loaded.",
  ])("preserves definite pre-dispatch failures: %s", async (message) => {
    mocks.ssrfSafeFetch.mockRejectedValueOnce(new Error(message));

    const error = await (handler as any)(makeEvent(makeFormData())).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ statusCode: 502 });
    expect(error).not.toHaveProperty("data.saveOutcomeUnknown");
  });

  it("preserves workspace-origin configuration errors before dispatch", async () => {
    mocks.workspacePrivateOrigins.mockImplementationOnce(() => {
      throw new Error("Invalid workspace app manifest");
    });

    const error = await (handler as any)(makeEvent(makeFormData())).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      statusCode: 502,
      statusMessage: expect.stringContaining("Invalid workspace app manifest"),
    });
    expect(error).not.toHaveProperty("data.saveOutcomeUnknown");
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("preserves a non-OK status when Design's error body cannot be read", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("response stream failed"));
      },
    });
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      new Response(body, { status: 503 }),
    );

    const error = await (handler as any)(makeEvent(makeFormData())).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      statusCode: 503,
      statusMessage: expect.stringContaining(
        "Analytics could not read its response",
      ),
      data: { saveOutcomeUnknown: true },
    });
  });

  it.each(["", "not-json"])(
    "marks an unknown save outcome when the 503 response body is %j",
    async (body) => {
      mocks.ssrfSafeFetch.mockResolvedValueOnce(
        new Response(body, { status: 503 }),
      );

      const error = await (handler as any)(makeEvent(makeFormData())).catch(
        (caught: unknown) => caught,
      );

      expect(error).toMatchObject({
        statusCode: 503,
        statusMessage: expect.stringContaining("invalid screenshot upload"),
        data: { saveOutcomeUnknown: true },
      });
    },
  );

  it("does not retry a 401 with an organization-principal fallback token", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValueOnce({
      apiKey: "test-a2a-token",
      apiKeyFallbacks: ["fallback-a2a-token"],
      userEmail: "alice@example.test",
    });
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      Response.json(
        { statusMessage: "A user identity token is required" },
        { status: 401 },
      ),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: "A user identity token is required",
    });
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("requires a user identity token before reading or writing Design", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValueOnce({
      userEmail: "alice@example.test",
    });

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Analytics could not authenticate the Design upload",
    });
    expect(mocks.invokeAgentAction).not.toHaveBeenCalled();
    expect(mocks.ssrfSafeFetch).not.toHaveBeenCalled();
  });

  it("preserves a Design authorization failure without retrying", async () => {
    mocks.resolveA2ACallerAuth.mockResolvedValueOnce({
      apiKey: "test-a2a-token",
      apiKeyFallbacks: ["fallback-a2a-token"],
      userEmail: "alice@example.test",
    });
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      Response.json(
        { statusMessage: "You do not have editor access" },
        { status: 403 },
      ),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: "You do not have editor access",
    });
    expect(mocks.ssrfSafeFetch).toHaveBeenCalledTimes(1);
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
      await vi.advanceTimersByTimeAsync(60_000);
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
      statusMessage: expect.stringContaining("Check Design before retrying"),
      data: { saveOutcomeUnknown: true },
    });
  });

  it("marks a failed 2xx response-body read as an unknown save outcome", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("response stream failed"));
      },
    });
    mocks.ssrfSafeFetch.mockResolvedValueOnce(new Response(body));

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: expect.stringContaining("Check Design before retrying"),
      data: { saveOutcomeUnknown: true },
    });
  });

  it("marks malformed 2xx upload JSON as an unknown save outcome", async () => {
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      new Response("not valid JSON", { status: 200 }),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 502,
      statusMessage: expect.stringContaining("Check Design before retrying"),
      data: { saveOutcomeUnknown: true },
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

  it("preserves cleanup failure when Design could not queue blob retries", async () => {
    mocks.ssrfSafeFetch.mockResolvedValueOnce(
      Response.json(
        {
          statusMessage: "The Design action failed",
          data: {
            action: "add-session-replay-screenshots-to-board",
            cleanupFailed: true,
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
        cleanupFailed: true,
      },
    });
  });
});

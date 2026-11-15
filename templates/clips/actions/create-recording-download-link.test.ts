import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockActionContractError extends Error {
    constructor(
      message: string,
      readonly options: { errorCode?: string; statusCode?: number },
    ) {
      super(message);
    }
  }
  return {
    MockActionContractError,
    resolveAccess: vi.fn(),
    createScopedAgentAccessGrant: vi.fn(),
    getRequestContext: vi.fn(),
    contextClipIdForFootage: vi.fn(),
  };
});

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
  fail: (
    message: string,
    options: { errorCode?: string; statusCode?: number },
  ) => {
    throw new mocks.MockActionContractError(message, options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  createScopedAgentAccessGrant: (...args: unknown[]) =>
    mocks.createScopedAgentAccessGrant(...args),
  verifyScopedAgentAccessToken: vi.fn(),
  getAppProductionUrl: () => "https://clips.example",
  getRequestContext: (...args: unknown[]) => mocks.getRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../server/db/index.js", () => ({ getDb: vi.fn(), schema: {} }));

vi.mock("../server/lib/context-footage.js", () => ({
  contextClipIdForFootage: (...args: unknown[]) =>
    mocks.contextClipIdForFootage(...args),
}));

vi.mock("../server/lib/public-agent-context.js", () => ({
  getServerAppBasePath: () => "/clips",
}));

import action from "./create-recording-download-link";

const recording = {
  id: "rec-1",
  ownerEmail: "owner@example.com",
  status: "ready",
  failureCode: null,
  trashedAt: null,
  editsJson: null,
  videoUrl: "https://storage.example.com/clips/rec-1/clip.webm",
  videoFormat: "webm",
  videoSizeBytes: 1_234,
  durationMs: 14_100,
};

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(mocks.MockActionContractError);
  return error as InstanceType<typeof mocks.MockActionContractError>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestContext.mockReturnValue({
    requestOrigin: "https://beta.clips.example/some/page",
  });
  mocks.contextClipIdForFootage.mockResolvedValue(null);
  mocks.resolveAccess.mockResolvedValue({ role: "owner", resource: recording });
  mocks.createScopedAgentAccessGrant.mockReturnValue({
    token: "download-token",
    expiresAt: "2026-10-26T12:10:00.000Z",
    ttlSeconds: 600,
  });
});

describe("create-recording-download-link", () => {
  it("gives the owner a link to the recording's video that expires in ten minutes", async () => {
    await expect(action.run({ recordingId: "rec-1" })).resolves.toEqual({
      recordingId: "rec-1",
      url: "https://beta.clips.example/clips/api/video/rec-1?download_access=download-token",
      expiresAt: "2026-10-26T12:10:00.000Z",
      ttlSeconds: 600,
      videoFormat: "webm",
      sizeBytes: 1_234,
      durationMs: 14_100,
    });
    expect(mocks.resolveAccess).toHaveBeenCalledWith("recording", "rec-1");
    expect(mocks.createScopedAgentAccessGrant).toHaveBeenCalledWith({
      resourceKind: "clip-video-download",
      resourceId: JSON.stringify(["rec-1", "owner@example.com"]),
      ttlSeconds: 600,
    });
    expect(
      action.outputSchema.safeParse(await action.run({ recordingId: "rec-1" }))
        .success,
    ).toBe(true);
  });

  it("passes a chosen lifetime through", async () => {
    await action.run({ recordingId: "rec-1", ttlSeconds: 60 });

    expect(mocks.createScopedAgentAccessGrant).toHaveBeenCalledWith(
      expect.objectContaining({ ttlSeconds: 60 }),
    );
  });

  it("keeps lifetimes between one minute and an hour", () => {
    for (const ttlSeconds of [59, 3_601, 1.5]) {
      expect(
        action.schema.safeParse({ recordingId: "rec-1", ttlSeconds }).success,
      ).toBe(false);
    }
    for (const ttlSeconds of [60, 3_600]) {
      expect(
        action.schema.safeParse({ recordingId: "rec-1", ttlSeconds }).success,
      ).toBe(true);
    }
  });

  it("reports sizes Clips doesn't know yet as null", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "owner",
      resource: { ...recording, videoSizeBytes: 0, durationMs: 0 },
    });

    await expect(action.run({ recordingId: "rec-1" })).resolves.toMatchObject({
      sizeBytes: null,
      durationMs: null,
    });
  });

  it.each(["admin", "editor", "commenter", "viewer"])(
    "refuses a %s who isn't the owner",
    async (role) => {
      mocks.resolveAccess.mockResolvedValue({ role, resource: recording });

      const error = await failureOf(action.run({ recordingId: "rec-1" }));

      expect(error.options).toEqual({
        errorCode: "owner_only",
        statusCode: 403,
      });
      expect(mocks.createScopedAgentAccessGrant).not.toHaveBeenCalled();
    },
  );

  it("refuses someone with no access the same way", async () => {
    mocks.resolveAccess.mockResolvedValue(null);

    const error = await failureOf(action.run({ recordingId: "rec-1" }));

    expect(error.options.errorCode).toBe("owner_only");
    expect(mocks.createScopedAgentAccessGrant).not.toHaveBeenCalled();
  });

  it("refuses earlier screen time attached to a clip", async () => {
    mocks.contextClipIdForFootage.mockResolvedValue("clip-1");

    const error = await failureOf(action.run({ recordingId: "rec-1" }));

    expect(error.options.errorCode).toBe("footage_not_downloadable");
    expect(mocks.createScopedAgentAccessGrant).not.toHaveBeenCalled();
  });

  it("refuses a recording that isn't ready", async () => {
    mocks.resolveAccess.mockResolvedValue({
      role: "owner",
      resource: { ...recording, status: "processing" },
    });

    const error = await failureOf(action.run({ recordingId: "rec-1" }));

    expect(error.options).toEqual({ errorCode: "not_ready", statusCode: 409 });
    expect(mocks.createScopedAgentAccessGrant).not.toHaveBeenCalled();
  });
});

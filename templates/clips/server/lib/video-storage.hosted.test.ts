import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeProvider: null as any,
  requestContext: { userEmail: "owner@example.com", authUserId: "user-1" } as
    | Record<string, unknown>
    | undefined,
  recordingRows: [] as Array<Record<string, unknown>>,
}));
const mockReserveHostedClipAllowance = vi.hoisted(() => vi.fn());
const mockGetActiveFileUploadProviderForRequest = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());
const hostedProvider = vi.hoisted(() => ({ id: "clips-hosted" }));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    mockGetActiveFileUploadProviderForRequest(...args),
  listFileUploadProviders: () => [],
}));
vi.mock("@agent-native/core/server", () => ({
  BUILDER_ASSETS_WRITE_SCOPE: "assets:write",
  canAuthorizeBuilderApiRequest: vi.fn(async () => false),
  getAppConfig: () => ({
    clips: {
      hostedStorage: {
        enabled: true,
        endpoint: "https://r2.example.test",
        bucket: "clips",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret",
        region: "auto",
        perIdentityClipLimit: 3,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
        retainedByteAlertRatio: 0.8,
      },
    },
  }),
  hasBuilderApiCredentialCustody: vi.fn(async () => false),
  resolveClipsHostedStorageConfig: (config: unknown) => config,
  runWithRequestContext: async (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => state.requestContext,
}));
vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute: vi.fn() }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));
vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordings: { id: "recordings.id", storageMode: "recordings.storageMode" },
    hostedClipAllowances: { userId: "allowances.userId" },
  },
}));
vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => args,
}));
vi.mock("./hosted-clip-allowance.js", () => ({
  canonicalHostedClipIdentityKey: (email: string) => email.toLowerCase(),
  getHostedClipAllowanceSnapshot: vi.fn(),
  getHostedClipAllowanceStatus: vi.fn(),
  hostedClipIpPrefix: vi.fn(),
  releaseHostedClipAllowance: vi.fn(),
  reserveHostedClipAllowance: (...args: unknown[]) =>
    mockReserveHostedClipAllowance(...args),
}));
vi.mock("./hosted-clip-disposable-domains.js", () => ({
  HOSTED_CLIP_DISPOSABLE_EMAIL_DOMAINS: new Set(),
}));
vi.mock("./s3-upload-provider.js", () => ({
  clipsHostedFileUploadProvider: hostedProvider,
  fetchS3ObjectByUrl: vi.fn(),
}));

import { resolveClipsVideoStorage } from "./video-storage.js";

describe("hosted Clips storage mode pinning", () => {
  beforeEach(() => {
    state.activeProvider = { id: "s3", name: "S3-compatible storage" };
    state.requestContext = {
      userEmail: "owner@example.com",
      authUserId: "user-1",
    };
    state.recordingRows = [];
    mockReserveHostedClipAllowance.mockReset();
    mockReserveHostedClipAllowance.mockResolvedValue({
      ok: true,
      allowance: { recordingId: "recording-1" },
      alreadyReserved: false,
    });
    mockGetActiveFileUploadProviderForRequest.mockReset();
    mockGetActiveFileUploadProviderForRequest.mockImplementation(
      async () => state.activeProvider,
    );
    mockGetDb.mockReset();
    mockGetDb.mockImplementation(() => ({
      select: () => {
        const builder = {
          from: () => builder,
          where: () => builder,
          limit: async () => state.recordingRows,
        };
        return builder;
      },
    }));
  });

  it("always selects the user's own provider before hosted trial storage", async () => {
    const resolved = await resolveClipsVideoStorage({
      intent: "new",
      recordingId: "recording-1",
      email: "owner@example.com",
      requestHeaders: new Headers(),
    });

    expect(resolved).toMatchObject({
      mode: "own",
      provider: state.activeProvider,
    });
    expect(mockReserveHostedClipAllowance).not.toHaveBeenCalled();
  });

  it("keeps an in-flight hosted recording pinned after Builder connects", async () => {
    state.recordingRows = [{ storageMode: "hosted" }];
    state.activeProvider = { id: "builder", name: "Builder.io" };

    const resolved = await resolveClipsVideoStorage({
      intent: "existing",
      recordingId: "recording-1",
      email: "owner@example.com",
    });

    expect(resolved).toMatchObject({
      mode: "hosted",
      provider: hostedProvider,
    });
    expect(mockGetActiveFileUploadProviderForRequest).not.toHaveBeenCalled();
    expect(mockReserveHostedClipAllowance).not.toHaveBeenCalled();
  });
});

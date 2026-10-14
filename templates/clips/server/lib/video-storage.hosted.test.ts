import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeProvider: null as any,
  requestContext: { userEmail: "owner@example.com", authUserId: "user-1" } as
    | Record<string, unknown>
    | undefined,
  recordingRows: [] as Array<Record<string, unknown>>,
}));
const mockReserveHostedClipAllowance = vi.hoisted(() => vi.fn());
const mockGetHostedClipAllowanceSnapshot = vi.hoisted(() => vi.fn());
const mockGetActiveFileUploadProviderForRequest = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());
const mockDbExec = vi.hoisted(() => vi.fn());
const mockFetchS3ObjectByUrl = vi.hoisted(() => vi.fn());
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
  getDbExec: () => ({ execute: (...args: unknown[]) => mockDbExec(...args) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  desc: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
}));
vi.mock("../db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    recordings: {
      id: "recordings.id",
      storageMode: "recordings.storageMode",
      ownerEmail: "recordings.ownerEmail",
      failureCode: "recordings.failureCode",
      createdAt: "recordings.createdAt",
    },
    hostedClipAllowances: { userId: "allowances.userId" },
  },
}));
vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => args,
}));
vi.mock("./hosted-clip-allowance.js", () => ({
  canonicalHostedClipIdentityKey: (email: string) => email.toLowerCase(),
  getHostedClipAllowanceSnapshot: (...args: unknown[]) =>
    mockGetHostedClipAllowanceSnapshot(...args),
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
  fetchS3ObjectByUrl: (...args: unknown[]) => mockFetchS3ObjectByUrl(...args),
}));

import {
  getClipsVideoStorageStatus,
  resolveClipsVideoStorage,
} from "./video-storage.js";

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
          orderBy: () => builder,
          limit: async () => state.recordingRows,
        };
        return builder;
      },
    }));
    mockGetHostedClipAllowanceSnapshot.mockReset();
    mockDbExec.mockReset();
    mockDbExec.mockResolvedValue({
      rows: [{ email: "owner@example.com", email_verified: true }],
    });
    mockFetchS3ObjectByUrl.mockReset();
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

  it("surfaces an observed hosted provider failure separately from an available allowance", async () => {
    state.activeProvider = null;
    state.recordingRows = [{ failureCode: "hosted_storage_unavailable" }];
    mockGetHostedClipAllowanceSnapshot.mockResolvedValue({
      status: "available",
      remainingCount: 2,
      denialReason: null,
    });

    await expect(
      getClipsVideoStorageStatus({
        email: "owner@example.com",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      configured: true,
      mode: "hosted",
      hostedRemaining: 2,
      providerError: "hosted_storage_unavailable",
    });
    expect(mockFetchS3ObjectByUrl).not.toHaveBeenCalled();
  });

  it("keeps provider errors separate from an exhausted hosted allowance", async () => {
    state.activeProvider = null;
    state.recordingRows = [{ failureCode: "hosted_storage_unavailable" }];
    mockGetHostedClipAllowanceSnapshot.mockResolvedValue({
      status: "denied",
      remainingCount: 0,
      denialReason: "exhausted",
    });

    await expect(
      getClipsVideoStorageStatus({
        email: "owner@example.com",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      configured: false,
      mode: "none",
      denyReason: "exhausted",
      providerError: "hosted_storage_unavailable",
    });
  });
});

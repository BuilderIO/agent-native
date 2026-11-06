import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeProvider: null as any,
  requestContext: { userEmail: "owner@example.com", authUserId: "user-1" } as
    | Record<string, unknown>
    | undefined,
  recordingRows: [] as Array<Record<string, unknown>>,
}));
const mockReserveHostedClipAllowance = vi.hoisted(() => vi.fn());
const mockConsumeHostedClipAllowance = vi.hoisted(() => vi.fn());
const mockGetHostedClipAllowanceSnapshot = vi.hoisted(() => vi.fn());
const mockGetActiveFileUploadProviderForRequest = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());
const mockDbExec = vi.hoisted(() => vi.fn());
const mockFetchS3ObjectByUrl = vi.hoisted(() => vi.fn());
const mockIsFeatureFlagEnabled = vi.hoisted(() => vi.fn());
const mockResolveHostedConfig = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const hostedProvider = vi.hoisted(() => ({ id: "clips-hosted" }));

vi.mock("@agent-native/core/file-upload", () => ({
  getActiveFileUploadProviderForRequest: (...args: unknown[]) =>
    mockGetActiveFileUploadProviderForRequest(...args),
  getBuilderUploadCredentialStatus: async () => ({
    builderConfigured: false,
    builderUploadConfigured: false,
    builderReauthorizationRequired: false,
  }),
  listFileUploadProviders: () => [],
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: (...args: unknown[]) =>
    mockIsFeatureFlagEnabled(...args),
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
  resolveClipsHostedStorageConfig: (...args: unknown[]) =>
    mockResolveHostedConfig(...args),
  runWithRequestContext: async (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
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
    hostedClipAllowances: {
      userId: "allowances.userId",
      recordingId: "allowances.recordingId",
      identityKey: "allowances.identityKey",
    },
  },
}));
vi.mock("./recordings.js", () => ({
  ownerEmailMatches: (...args: unknown[]) => args,
}));
vi.mock("./hosted-clip-allowance.js", () => ({
  canonicalHostedClipIdentityKey: (email: string) => email.toLowerCase(),
  consumeHostedClipAllowance: (...args: unknown[]) =>
    mockConsumeHostedClipAllowance(...args),
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
  consumeHostedClipRecording,
  getClipsVideoStorageStatus,
  resolveClipsVideoStorage,
} from "./video-storage.js";

describe("hosted Clips storage mode pinning", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test/clips");
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
      remainingCount: 2,
    });
    mockResolveHostedConfig.mockReset();
    mockResolveHostedConfig.mockImplementation((config: unknown) => config);
    mockTrack.mockReset();
    mockGetActiveFileUploadProviderForRequest.mockReset();
    mockGetActiveFileUploadProviderForRequest.mockImplementation(
      async () => state.activeProvider,
    );
    mockIsFeatureFlagEnabled.mockReset();
    mockIsFeatureFlagEnabled.mockResolvedValue(true);
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

  it("refuses a file over the hosted limit before reserving a grant", async () => {
    state.activeProvider = null;
    const resolveWithSize = (sizeBytes: number) =>
      resolveClipsVideoStorage({
        intent: "new",
        recordingId: "recording-1",
        email: "owner@example.com",
        sizeBytes,
      });

    await expect(resolveWithSize(250 * 1024 * 1024 + 1)).rejects.toMatchObject({
      statusCode: 413,
      errorCode: "upload_too_large",
      // One byte over still reads as over the limit, not as the limit itself.
      message: expect.stringMatching(
        /250\.1 MB.*free hosted storage takes clips up to 250 MB.*up to 2 GB/,
      ),
      details: {
        sizeBytes: 250 * 1024 * 1024 + 1,
        maxUploadBytes: 250 * 1024 * 1024,
        storageMode: "hosted",
      },
    });
    expect(mockReserveHostedClipAllowance).not.toHaveBeenCalled();

    await expect(resolveWithSize(250 * 1024 * 1024)).resolves.toMatchObject({
      mode: "hosted",
    });
    expect(mockReserveHostedClipAllowance).toHaveBeenCalledOnce();
  });

  it("does not apply the hosted limit to the user's own storage", async () => {
    await expect(
      resolveClipsVideoStorage({
        intent: "new",
        recordingId: "recording-1",
        email: "owner@example.com",
        sizeBytes: 300 * 1024 * 1024,
      }),
    ).resolves.toMatchObject({ mode: "own", provider: state.activeProvider });
  });

  it("keeps an in-flight hosted recording pinned after Builder connects", async () => {
    state.recordingRows = [{ storageMode: "hosted" }];
    state.activeProvider = { id: "builder", name: "Builder.io" };
    mockIsFeatureFlagEnabled.mockResolvedValue(false);

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
    expect(mockIsFeatureFlagEnabled).not.toHaveBeenCalled();
    expect(mockReserveHostedClipAllowance).not.toHaveBeenCalled();
  });

  it("does not offer or reserve a new hosted grant while the flag is off", async () => {
    state.activeProvider = null;
    mockIsFeatureFlagEnabled.mockResolvedValue(false);

    await expect(
      resolveClipsVideoStorage({
        intent: "new",
        recordingId: "recording-1",
        email: "owner@example.com",
      }),
    ).resolves.toMatchObject({
      mode: "none",
      hostedRemaining: 0,
      denyReason: "disabled",
    });

    await expect(
      getClipsVideoStorageStatus({
        email: "owner@example.com",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      configured: false,
      mode: "none",
      hostedRemaining: 0,
      hostedLimit: 0,
      denyReason: "disabled",
    });
    expect(mockDbExec).not.toHaveBeenCalled();
    expect(mockGetHostedClipAllowanceSnapshot).not.toHaveBeenCalled();
    expect(mockReserveHostedClipAllowance).not.toHaveBeenCalled();
  });

  it("reports local SQL chunk scratch separately from connected storage", async () => {
    vi.stubEnv("APP_NAME", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "pglite:clips");
    state.activeProvider = null;
    mockIsFeatureFlagEnabled.mockResolvedValue(false);

    await expect(
      getClipsVideoStorageStatus({
        email: "owner@example.com",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      configured: false,
      mode: "none",
      localSqlChunkScratchAvailable: true,
      denyReason: "disabled",
    });
  });

  it("lets a targeted user reserve a grant while keeping other users off", async () => {
    state.activeProvider = null;
    mockIsFeatureFlagEnabled.mockImplementation(
      async (_flag: unknown, scope: { userEmail?: string }) =>
        scope.userEmail === "alice@example.com",
    );
    mockDbExec.mockResolvedValue({
      rows: [{ email: "alice@example.com", email_verified: true }],
    });

    const alice = await resolveClipsVideoStorage({
      intent: "new",
      recordingId: "alice-recording",
      email: "alice@example.com",
      userId: "alice",
    });
    const bob = await resolveClipsVideoStorage({
      intent: "new",
      recordingId: "bob-recording",
      email: "bob@example.com",
      userId: "bob",
    });

    expect(alice.mode).toBe("hosted");
    expect(bob).toMatchObject({ mode: "none", denyReason: "disabled" });
    expect(mockReserveHostedClipAllowance).toHaveBeenCalledTimes(1);
    expect(mockReserveHostedClipAllowance).toHaveBeenCalledWith(
      expect.objectContaining({ email: "alice@example.com", userId: "alice" }),
    );
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

  it("finds an allowance by recording id after the owner's email changed", async () => {
    const wheres: unknown[] = [];
    const rowsBySelect = [
      [{ ownerEmail: "new@example.com" }],
      [{ userId: "user-1" }],
    ];
    mockGetDb.mockImplementation(() => ({
      select: () => {
        const rows = rowsBySelect.shift() ?? [];
        const builder = {
          from: () => builder,
          where: (clause: unknown) => {
            wheres.push(clause);
            return builder;
          },
          limit: async () => rows,
        };
        return builder;
      },
    }));
    mockConsumeHostedClipAllowance.mockResolvedValue({ ok: true });

    await consumeHostedClipRecording({
      recordingId: "recording-1",
      ownerEmail: "new@example.com",
      actualBytes: 10,
    });

    expect(mockConsumeHostedClipAllowance).toHaveBeenCalledWith(
      expect.objectContaining({ recordingId: "recording-1", userId: "user-1" }),
    );
    expect(JSON.stringify(wheres[1])).not.toContain("allowances.identityKey");
  });

  it.each([
    ["missing user row", [], "hosted_identity_unverifiable"],
    [
      "email mismatch",
      [{ email: "someone-else@example.com", email_verified: true }],
      "hosted_identity_mismatch",
    ],
  ])(
    "fails the status read with a typed non-auth error for a %s",
    async (_name, rows, errorCode) => {
      state.activeProvider = null;
      mockDbExec.mockResolvedValue({ rows });
      await expect(getClipsVideoStorageStatus()).rejects.toMatchObject({
        errorCode,
        statusCode: 500,
      });
    },
  );

  it("takes the hosted remaining count from the reserve and never reads a separate snapshot", async () => {
    state.activeProvider = null;
    const create = (recordingId: string) =>
      resolveClipsVideoStorage({
        intent: "new",
        recordingId,
        email: "owner@example.com",
        userId: "user-1",
      });

    await expect(create("recording-1")).resolves.toMatchObject({
      mode: "hosted",
      hostedRemaining: 2,
      reservationCreated: true,
    });
    mockReserveHostedClipAllowance.mockResolvedValueOnce({
      ok: true,
      allowance: { recordingId: "recording-1" },
      alreadyReserved: true,
      remainingCount: 1,
    });
    await expect(create("recording-1")).resolves.toMatchObject({
      mode: "hosted",
      hostedRemaining: 1,
      reservationCreated: false,
    });
    expect(mockGetHostedClipAllowanceSnapshot).not.toHaveBeenCalled();
  });

  describe("when hosted storage is enabled but misconfigured", () => {
    const misconfigured = new Error(
      "Clips hosted storage is enabled but missing required settings: bucket.",
    );

    beforeEach(() => {
      mockResolveHostedConfig.mockImplementation(() => {
        throw misconfigured;
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("answers users with their own storage normally", async () => {
      await expect(
        resolveClipsVideoStorage({
          intent: "new",
          recordingId: "recording-1",
          email: "owner@example.com",
        }),
      ).resolves.toMatchObject({ mode: "own", provider: state.activeProvider });
      await expect(
        getClipsVideoStorageStatus({
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).resolves.toMatchObject({ configured: true, mode: "own" });
      state.recordingRows = [{ storageMode: "own" }];
      await expect(
        resolveClipsVideoStorage({
          intent: "existing",
          recordingId: "recording-1",
          email: "owner@example.com",
        }),
      ).resolves.toMatchObject({ mode: "own" });
      expect(mockResolveHostedConfig).not.toHaveBeenCalled();
    });

    it("answers local SQL scratch and flag-off users without the hosted config", async () => {
      state.activeProvider = null;
      mockIsFeatureFlagEnabled.mockResolvedValue(false);
      await expect(
        getClipsVideoStorageStatus({
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).resolves.toMatchObject({ mode: "none", denyReason: "disabled" });
      await expect(
        resolveClipsVideoStorage({
          intent: "new",
          recordingId: "recording-1",
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).resolves.toMatchObject({ mode: "none", denyReason: "disabled" });

      vi.stubEnv("APP_NAME", "");
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("DATABASE_URL", "pglite:clips");
      await expect(
        resolveClipsVideoStorage({
          intent: "new",
          recordingId: "recording-1",
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).resolves.toMatchObject({ mode: "own", provider: null });
      expect(mockResolveHostedConfig).not.toHaveBeenCalled();
    });

    it("fails the hosted path loudly, without reserving, and logs and tracks the misconfiguration", async () => {
      state.activeProvider = null;
      await expect(
        resolveClipsVideoStorage({
          intent: "new",
          recordingId: "recording-1",
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).rejects.toBe(misconfigured);
      await expect(
        getClipsVideoStorageStatus({
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).rejects.toBe(misconfigured);
      expect(mockReserveHostedClipAllowance).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        "[clips-hosted] hosted_storage_misconfigured",
        { message: misconfigured.message },
      );
      expect(mockTrack).toHaveBeenCalledWith(
        "clips_hosted_storage_misconfigured",
        expect.objectContaining({ message: misconfigured.message }),
        undefined,
      );
    });

    it("still fails an existing hosted recording", async () => {
      state.recordingRows = [{ storageMode: "hosted" }];
      await expect(
        resolveClipsVideoStorage({
          intent: "existing",
          recordingId: "recording-1",
          email: "owner@example.com",
        }),
      ).rejects.toBe(misconfigured);
      expect(mockTrack).toHaveBeenCalledWith(
        "clips_hosted_storage_misconfigured",
        expect.anything(),
        undefined,
      );
    });

    it("keeps the request failing when analytics throws", async () => {
      state.activeProvider = null;
      mockTrack.mockImplementation(() => {
        throw new Error("tracker down");
      });
      await expect(
        resolveClipsVideoStorage({
          intent: "new",
          recordingId: "recording-1",
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).rejects.toBe(misconfigured);
    });

    it("logs the tracking failure and still rethrows the config error", async () => {
      state.activeProvider = null;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockTrack.mockImplementation(() => {
        throw new Error("tracker down");
      });
      await expect(
        resolveClipsVideoStorage({
          intent: "new",
          recordingId: "recording-1",
          email: "owner@example.com",
          userId: "user-1",
        }),
      ).rejects.toBe(misconfigured);
      expect(warn).toHaveBeenCalledWith("[clips-hosted] tracking failed", {
        event: "clips_hosted_storage_misconfigured",
        error: "tracker down",
      });
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUploadFile = vi.hoisted(() => vi.fn());
const mockDeleteUploadedFile = vi.hoisted(() => vi.fn());
const mockRecordOrphanedVideoAssetCleanup = vi.hoisted(() => vi.fn());
const mockDeleteOrphanedVideoAssetCleanup = vi.hoisted(() => vi.fn());
const mockListOrphanedVideoAssetCleanups = vi.hoisted(() => vi.fn());
const mockListOrphanedUploadedAssetCleanupKeys = vi.hoisted(() => vi.fn());
const mockAppStateGetManyEntries = vi.hoisted(() => vi.fn());
const mockCompareAndSetAppState = vi.hoisted(() => vi.fn());
const mockValues = vi.hoisted(() => vi.fn());
const mockSelectLimit = vi.hoisted(() => vi.fn());
const mockSelectForUpdate = vi.hoisted(() => vi.fn());
const mockDeleteWhere = vi.hoisted(() => vi.fn());
const mockUpdateReturning = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn((...args: unknown[]) => args));
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockGetRequestOrgId = vi.hoisted(() => vi.fn());
const mockRegisterDeckUploadedAsset = vi.hoisted(() => vi.fn());
const mockReserveUploadedAssetRegistration = vi.hoisted(() => vi.fn());
const mockRecordUploadedAssetCleanupObject = vi.hoisted(() => vi.fn());
const mockCancelUploadedAssetRegistration = vi.hoisted(() => vi.fn());
const mockParkUnresolvedUploadedAssetRegistration = vi.hoisted(() => vi.fn());
const mockCompleteUploadedAssetRegistration = vi.hoisted(() => vi.fn());
const mockClearRegisteredUploadedAsset = vi.hoisted(() => vi.fn());
const mockClaimFailedUploadedAssetRegistration = vi.hoisted(() => vi.fn());
const mockScheduleUploadedAssetDeletion = vi.hoisted(() => vi.fn());
const mockFinishOwnedUploadedAssetCleanup = vi.hoisted(() => vi.fn());
const mockRetryOwnedUploadedAssetCleanup = vi.hoisted(() => vi.fn());
const mockListDueUploadedAssetCleanups = vi.hoisted(() => vi.fn());
const mockListRegisteredUploadedAssetCleanups = vi.hoisted(() => vi.fn());
const mockClaimDueUploadedAssetCleanup = vi.hoisted(() => vi.fn());
const mockRegisterUploadedAssetObjectIdentities = vi.hoisted(() => vi.fn());
const mockUploadedAssets = vi.hoisted(() => ({
  id: "uploaded_assets.id",
  filename: "uploaded_assets.filename",
  url: "uploaded_assets.url",
  type: "uploaded_assets.type",
  size: "uploaded_assets.size",
  provider: "uploaded_assets.provider",
  providerObjectId: "uploaded_assets.provider_object_id",
  deckId: "uploaded_assets.deck_id",
  uploadSessionId: "uploaded_assets.upload_session_id",
  orgId: "uploaded_assets.org_id",
  ownerEmail: "uploaded_assets.owner_email",
}));
const mockDecks = vi.hoisted(() => ({
  id: "decks.id",
  data: "decks.data",
  ownerEmail: "decks.owner_email",
  orgId: "decks.org_id",
}));
const mockUploadedAssetCleanupOutbox = vi.hoisted(() => ({
  id: "uploaded_asset_cleanup_outbox.id",
  ownerEmail: "uploaded_asset_cleanup_outbox.owner_email",
  orgId: "uploaded_asset_cleanup_outbox.org_id",
  intent: "uploaded_asset_cleanup_outbox.intent",
  state: "uploaded_asset_cleanup_outbox.state",
  leaseToken: "uploaded_asset_cleanup_outbox.lease_token",
}));

vi.mock("@agent-native/core/file-upload", () => ({
  uploadFile: mockUploadFile,
  deleteUploadedFile: mockDeleteUploadedFile,
}));

vi.mock("@agent-native/core/application-state", () => ({
  appStateGetManyEntries: mockAppStateGetManyEntries,
  compareAndSetAppState: mockCompareAndSetAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: () => mockGetRequestOrgId(),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: (...args: unknown[]) => args,
  desc: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => mockEq(...args),
  isNull: (...args: unknown[]) => ["isNull", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  notLike: (...args: unknown[]) => args,
  or: (...args: unknown[]) => ["or", ...args],
}));

vi.mock("../db/index.js", () => ({
  getDb: () => {
    const createDb = () => ({
      insert: () => ({ values: mockValues }),
      delete: () => ({ where: mockDeleteWhere }),
      update: () => ({
        set: () => ({ where: () => ({ returning: mockUpdateReturning }) }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: mockSelectLimit,
            for: mockSelectForUpdate,
          }),
        }),
      }),
      transaction: (callback: (tx: unknown) => unknown) =>
        mockTransaction(callback, createDb()),
    });
    return createDb();
  },
  schema: {
    uploadedAssets: mockUploadedAssets,
    uploadedAssetCleanupOutbox: mockUploadedAssetCleanupOutbox,
    decks: mockDecks,
  },
}));

vi.mock("../lib/deck-asset-scope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/deck-asset-scope.js")>()),
  assertDeckAssetUploadScope: vi.fn().mockResolvedValue(undefined),
  registerDeckUploadedAsset: mockRegisterDeckUploadedAsset,
}));

vi.mock("../lib/uploaded-asset-object-lifecycle.js", () => ({
  registerUploadedAssetObjectIdentities: (...args: unknown[]) =>
    mockRegisterUploadedAssetObjectIdentities(...args),
  deleteUploadedAssetObject: async (args: {
    identity: {
      url: string;
      provider: string | null;
      providerObjectId: string | null;
    };
    excludeAssetId?: string;
    deleteObject: () => Promise<boolean>;
    onShared?: (transaction: unknown) => Promise<void>;
    onAlreadyDeleted?: (transaction: unknown) => Promise<void>;
    onDeleted?: (transaction: unknown) => Promise<void>;
  }) => {
    const aliases = (
      (await mockSelectLimit()) as Array<{ id?: string }>
    ).filter((asset) => asset.id !== args.excludeAssetId);
    const transaction = {
      delete: () => ({ where: mockDeleteWhere }),
    };
    if (aliases.length > 0) {
      await args.onShared?.(transaction);
      return { status: "shared" };
    }
    try {
      if (!(await args.deleteObject())) {
        return {
          status: "failed",
          error: new Error("Storage deletion failed."),
        };
      }
      await args.onDeleted?.(transaction);
      return { status: "deleted" };
    } catch (error) {
      return { status: "failed", error };
    }
  },
}));

vi.mock("../lib/chunked-upload-session.js", () => ({
  recordOrphanedVideoAssetCleanup: mockRecordOrphanedVideoAssetCleanup,
  deleteOrphanedVideoAssetCleanup: mockDeleteOrphanedVideoAssetCleanup,
  listOrphanedVideoAssetCleanups: mockListOrphanedVideoAssetCleanups,
  listOrphanedUploadedAssetCleanupKeys:
    mockListOrphanedUploadedAssetCleanupKeys,
}));

vi.mock("../lib/uploaded-asset-cleanup-outbox.js", () => ({
  cancelUploadedAssetRegistration: mockCancelUploadedAssetRegistration,
  reserveUploadedAssetRegistration: mockReserveUploadedAssetRegistration,
  recordUploadedAssetCleanupObject: mockRecordUploadedAssetCleanupObject,
  parkUnresolvedUploadedAssetRegistration:
    mockParkUnresolvedUploadedAssetRegistration,
  completeUploadedAssetRegistration: mockCompleteUploadedAssetRegistration,
  clearRegisteredUploadedAsset: mockClearRegisteredUploadedAsset,
  claimFailedUploadedAssetRegistration:
    mockClaimFailedUploadedAssetRegistration,
  scheduleUploadedAssetDeletion: mockScheduleUploadedAssetDeletion,
  finishOwnedUploadedAssetCleanup: mockFinishOwnedUploadedAssetCleanup,
  retryOwnedUploadedAssetCleanup: mockRetryOwnedUploadedAssetCleanup,
  listDueUploadedAssetCleanups: mockListDueUploadedAssetCleanups,
  listRegisteredUploadedAssetCleanups: mockListRegisteredUploadedAssetCleanups,
  claimDueUploadedAssetCleanup: mockClaimDueUploadedAssetCleanup,
}));

import {
  canSaveAsUploadedAsset,
  canSaveAsUploadedVideoAsset,
  reapOrphanedUploadedAssetObjects,
  reapOrphanedVideoAssetObjects,
  uploadImageAsset,
  uploadVideoAsset,
} from "./assets";
import { uploadedAssetUrlForBasePath } from "./assets-url";

beforeEach(() => {
  mockUploadFile.mockReset();
  mockUploadFile.mockResolvedValue({
    provider: "builder",
    url: "https://cdn.builder.io/logo.svg",
  });
  mockDeleteUploadedFile.mockReset();
  mockDeleteUploadedFile.mockResolvedValue(true);
  mockRecordOrphanedVideoAssetCleanup.mockReset();
  mockRecordOrphanedVideoAssetCleanup.mockResolvedValue("cleanup-1");
  mockDeleteOrphanedVideoAssetCleanup.mockReset();
  mockDeleteOrphanedVideoAssetCleanup.mockResolvedValue(true);
  mockListOrphanedVideoAssetCleanups.mockReset();
  mockListOrphanedVideoAssetCleanups.mockResolvedValue([]);
  mockListOrphanedUploadedAssetCleanupKeys.mockReset();
  mockListOrphanedUploadedAssetCleanupKeys.mockResolvedValue([]);
  mockAppStateGetManyEntries.mockReset();
  mockAppStateGetManyEntries.mockResolvedValue([]);
  mockCompareAndSetAppState.mockReset();
  mockCompareAndSetAppState.mockResolvedValue(true);
  mockValues.mockReset();
  mockValues.mockResolvedValue(undefined);
  mockSelectLimit.mockReset();
  mockSelectLimit.mockResolvedValue([]);
  mockSelectForUpdate.mockReset();
  mockSelectForUpdate.mockResolvedValue([]);
  mockDeleteWhere.mockReset();
  mockDeleteWhere.mockResolvedValue(undefined);
  mockUpdateReturning.mockReset();
  mockUpdateReturning.mockResolvedValue([]);
  mockTransaction.mockReset();
  mockTransaction.mockImplementation(async (callback, tx) => callback(tx));
  mockEq.mockClear();
  mockGetRequestOrgId.mockReset();
  mockGetRequestOrgId.mockReturnValue(undefined);
  mockRegisterDeckUploadedAsset.mockReset();
  mockRegisterDeckUploadedAsset.mockResolvedValue(undefined);
  mockReserveUploadedAssetRegistration.mockReset();
  mockReserveUploadedAssetRegistration.mockResolvedValue("registration-token");
  mockRecordUploadedAssetCleanupObject.mockReset();
  mockRecordUploadedAssetCleanupObject.mockResolvedValue(true);
  mockCancelUploadedAssetRegistration.mockReset();
  mockCancelUploadedAssetRegistration.mockResolvedValue(true);
  mockParkUnresolvedUploadedAssetRegistration.mockReset();
  mockParkUnresolvedUploadedAssetRegistration.mockResolvedValue(true);
  mockCompleteUploadedAssetRegistration.mockReset();
  mockCompleteUploadedAssetRegistration.mockResolvedValue(undefined);
  mockClearRegisteredUploadedAsset.mockReset();
  mockClearRegisteredUploadedAsset.mockResolvedValue(true);
  mockClaimFailedUploadedAssetRegistration.mockReset();
  mockClaimFailedUploadedAssetRegistration.mockResolvedValue("deletion-token");
  mockScheduleUploadedAssetDeletion.mockReset();
  mockScheduleUploadedAssetDeletion.mockResolvedValue("deletion-token");
  mockFinishOwnedUploadedAssetCleanup.mockReset();
  mockFinishOwnedUploadedAssetCleanup.mockResolvedValue(true);
  mockRetryOwnedUploadedAssetCleanup.mockReset();
  mockRetryOwnedUploadedAssetCleanup.mockResolvedValue(true);
  mockListDueUploadedAssetCleanups.mockReset();
  mockListDueUploadedAssetCleanups.mockResolvedValue([]);
  mockListRegisteredUploadedAssetCleanups.mockReset();
  mockListRegisteredUploadedAssetCleanups.mockResolvedValue([]);
  mockClaimDueUploadedAssetCleanup.mockReset();
  mockClaimDueUploadedAssetCleanup.mockResolvedValue(null);
  mockRunWithRequestContext.mockReset();
  mockRunWithRequestContext.mockImplementation(
    async (_context: unknown, callback: () => unknown) => callback(),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("uploadedAssetUrl", () => {
  it("returns root-relative upload URLs without a configured base path", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "")).toBe(
      "/uploads/logo.png",
    );
  });

  it("prefixes upload URLs with APP_BASE_PATH", () => {
    expect(uploadedAssetUrlForBasePath("logo.png", "/slides/")).toBe(
      "/slides/uploads/logo.png",
    );
  });
});

describe("uploaded asset validation", () => {
  it("allows SVG assets", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "logo.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedAsset({
        originalName: "preamble.svg",
        data: Buffer.from(
          '<!-- generated -->\n<svg xmlns="http://www.w3.org/2000/svg" />',
        ),
      }),
    ).toBe(true);
  });

  it("strips the standard SVG 1.1 doctype before uploading Excalidraw SVGs", async () => {
    const svg = Buffer.from(
      '<?xml version="1.0" standalone="no"?>\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
        '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
        '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 20"><path d="M0 0h38" /></svg>',
    );
    const strippedSvg = new TextEncoder().encode(
      svg
        .toString("utf8")
        .replace(
          /<!DOCTYPE svg PUBLIC "-\/\/W3C\/\/DTD SVG 1\.1\/\/EN" "http:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd">/,
          "",
        ),
    );

    expect(
      canSaveAsUploadedAsset({ originalName: "arrow.svg", data: svg }),
    ).toBe(true);
    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "arrow.svg",
        data: svg,
        type: "image/svg+xml",
      }),
    ).resolves.toMatchObject({
      type: "image/svg+xml",
      size: strippedSvg.length,
    });
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: strippedSvg, filename: "arrow.svg" }),
    );
  });

  it("allows parameterized safe raster data URLs inside SVG assets", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "logo.svg",
        data: Buffer.from(
          '<svg><image href="data:image/png;charset=binary;base64,AQID" /></svg>',
        ),
      }),
    ).toBe(true);
  });

  it("rejects SVGs with active content or external references", () => {
    expect(
      canSaveAsUploadedAsset({
        originalName: "script.svg",
        data: Buffer.from('<svg onload="alert(1)" />'),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "remote.svg",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "unquoted-remote.svg",
        data: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><image href=https://example.com/x.png /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "namespaced-script.svg",
        data: Buffer.from(
          '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "encoded-css.svg",
        data: Buffer.from(
          "<svg><style>&#64;import&#32;url&#40;https://example.com/style.css&#41;;</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "escaped-css.svg",
        data: Buffer.from(
          "<svg><style>u\\72l(https://example.com/style.css){}</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "escaped-newline-css.svg",
        data: Buffer.from(
          "<svg><style>url(https://example.com/font\\" +
            "\n.woff2)</style></svg>",
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "image-set-css.svg",
        data: Buffer.from(
          '<svg><style>rect{fill:image-set("https://example.com/pixel" 1x)}</style><rect /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "image-css.svg",
        data: Buffer.from(
          '<svg><style>rect{fill:image("https://example.com/pixel")}</style><rect /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "animate-transform.svg",
        data: Buffer.from(
          '<svg><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s" repeatCount="indefinite" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "commented-css.svg",
        data: Buffer.from(
          '<svg><style>@im/**/port "https://example.com/style.css";</style></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "xml-base.svg",
        data: Buffer.from(
          '<svg xml:base="https://example.com/"><use href="#icon" /></svg>',
        ),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedAsset({
        originalName: "external-entity.svg",
        data: Buffer.from(
          '<!DOCTYPE svg [<!ENTITY remote SYSTEM "https://example.com/evil">]>' +
            "<svg>&remote;</svg>",
        ),
      }),
    ).toBe(false);
  });

  it("normalizes SVG MIME before sending it to the upload provider", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "logo.svg",
        data: svg,
        type: "application/octet-stream",
      }),
    ).resolves.toMatchObject({ type: "image/svg+xml" });

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: svg,
        filename: "logo.svg",
        mimeType: "image/svg+xml",
        ownerEmail: "owner@example.com",
      }),
    );
  });

  it("keeps the active organization while creating the public asset", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');
    mockGetRequestOrgId.mockReturnValue("active-org");

    const asset = await uploadImageAsset({
      email: "owner@example.com",
      originalName: "logo.svg",
      data: svg,
      type: "image/svg+xml",
    });

    expect(asset.id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: asset.id,
        orgId: "active-org",
        ownerEmail: "owner@example.com",
        url: asset.url,
      }),
    );

    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "active-org" },
      expect.any(Function),
    );
  });

  it("persists the storage object handle without exposing it as the asset ID", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />');
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      url: "https://storage.example.com/uploads/object-key.svg",
      id: "uploads/object-key.svg",
    });

    const asset = await uploadImageAsset({
      email: "owner@example.com",
      originalName: "logo.svg",
      data: svg,
      type: "image/svg+xml",
    });

    expect(asset.id).not.toBe("uploads/object-key.svg");
    expect(asset).not.toHaveProperty("providerObjectId");
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: asset.id,
        provider: "s3",
        providerObjectId: "uploads/object-key.svg",
      }),
    );
  });

  it("bounds opportunistic SQL outbox scans on image and video uploads", async () => {
    await uploadImageAsset({
      email: "owner@example.com",
      originalName: "logo.svg",
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
    });
    await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: makeMp4Video(),
    });

    expect(mockListDueUploadedAssetCleanups).toHaveBeenCalledTimes(2);
    expect(mockListRegisteredUploadedAssetCleanups).toHaveBeenCalledTimes(2);
    expect(mockListDueUploadedAssetCleanups).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
    expect(mockAppStateGetManyEntries).not.toHaveBeenCalled();
  });

  it("does not upload an image when its SQL cleanup reservation fails", async () => {
    mockReserveUploadedAssetRegistration.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "image.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).rejects.toMatchObject({ errorCode: "image_asset_registration_failed" });

    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("does not upload a video when its SQL cleanup reservation fails", async () => {
    mockReserveUploadedAssetRegistration.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: makeMp4Video(),
      }),
    ).rejects.toMatchObject({ errorCode: "video_asset_registration_failed" });

    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it("queues trusted SQL cleanup when image registration fails", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
    mockValues.mockRejectedValueOnce(new Error("asset row insert failed"));

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "image.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).rejects.toMatchObject({ errorCode: "image_asset_registration_failed" });

    expect(mockReserveUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.any(String),
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      }),
    );
    expect(
      mockReserveUploadedAssetRegistration.mock.invocationCallOrder[0],
    ).toBeLessThan(mockUploadFile.mock.invocationCallOrder[0]);
    expect(mockRecordUploadedAssetCleanupObject).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "s3",
        providerObjectId: "image-object-1",
        url: "https://cdn.example.com/image.png",
      }),
      "registration-token",
    );
    expect(mockClaimFailedUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      }),
      "registration-token",
    );
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
    expect(mockFinishOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerEmail: "owner@example.com" }),
      "deletion-token",
    );
  });

  it("keeps image cleanup queued when provider deletion fails", async () => {
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
    mockValues.mockRejectedValueOnce(new Error("asset row insert failed"));
    mockDeleteUploadedFile.mockResolvedValueOnce(false);

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "image.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).rejects.toMatchObject({ errorCode: "image_asset_registration_failed" });

    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
    expect(mockRetryOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "deletion-token",
      1,
    );
    expect(mockFinishOwnedUploadedAssetCleanup).not.toHaveBeenCalled();
  });

  it("does not delete an image object when registration cannot be checked", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
    mockValues.mockRejectedValueOnce(new Error("insert acknowledgement lost"));
    mockSelectLimit.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        originalName: "image.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).rejects.toMatchObject({ errorCode: "image_asset_registration_failed" });

    expect(mockClaimFailedUploadedAssetRegistration).not.toHaveBeenCalled();
    expect(mockClearRegisteredUploadedAsset).not.toHaveBeenCalled();
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("passes image registration through the deck-scoped transaction helper", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");

    const asset = await uploadImageAsset({
      email: "owner@example.com",
      orgId: "active-org",
      deckId: "deck-1",
      originalName: "image.svg",
      data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
    });

    expect(mockRegisterDeckUploadedAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        email: "owner@example.com",
        orgId: "active-org",
        row: expect.objectContaining({
          id: asset.id,
          deckId: "deck-1",
          orgId: "active-org",
        }),
      }),
    );
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("uses the trusted reservation when the deck disappears before registration", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
    mockRegisterDeckUploadedAsset.mockRejectedValueOnce(
      Object.assign(new Error("Deck not found."), {
        errorCode: "deck_not_found",
        statusCode: 404,
      }),
    );

    await expect(
      uploadImageAsset({
        email: "owner@example.com",
        orgId: "active-org",
        deckId: "deck-1",
        originalName: "image.svg",
        data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" />'),
      }),
    ).rejects.toMatchObject({ errorCode: "deck_not_found" });

    expect(mockValues).not.toHaveBeenCalled();
    expect(mockClaimFailedUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.any(String),
        provider: "s3",
        providerObjectId: "image-object-1",
      }),
      "registration-token",
    );
    expect(
      mockClaimFailedUploadedAssetRegistration.mock.invocationCallOrder[0],
    ).toBeLessThan(mockDeleteUploadedFile.mock.invocationCallOrder[0]);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "image-object-1",
      url: "https://cdn.example.com/image.png",
    });
  });
});

function uint32Bytes(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function isoBox(type: string, payload: Uint8Array): Buffer {
  return Buffer.concat([
    uint32Bytes(payload.length + 8),
    Buffer.from(type),
    payload,
  ]);
}

function makeAvcSampleDescription(includeConfiguration = true): Buffer {
  const configuration = isoBox(
    "avcC",
    Buffer.from([
      1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 5, 0x67, 0x42, 0, 0x1e, 0x80, 1, 0, 2,
      0x68, 0xc0,
    ]),
  );
  return isoBox(
    "avc1",
    Buffer.concat([
      Buffer.alloc(78),
      ...(includeConfiguration ? [configuration] : []),
    ]),
  );
}

function makeMp4Video(
  options: {
    hasSample?: boolean;
    sampleOffset?: number;
    includeAvcConfiguration?: boolean;
  } = {},
): Buffer {
  const hasSample = options.hasSample ?? true;
  const ftyp = isoBox(
    "ftyp",
    Buffer.concat([Buffer.from("isom"), uint32Bytes(0), Buffer.from("isom")]),
  );
  const mediaData = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  const mdat = isoBox("mdat", mediaData);
  const sampleOffset = options.sampleOffset ?? ftyp.length + 8;
  const sampleCount = hasSample ? 1 : 0;
  const tableEntries = hasSample ? 1 : 0;
  const sampleDescription = makeAvcSampleDescription(
    options.includeAvcConfiguration,
  );
  const stbl = isoBox(
    "stbl",
    Buffer.concat([
      isoBox(
        "stsd",
        Buffer.concat([Buffer.alloc(4), uint32Bytes(1), sampleDescription]),
      ),
      isoBox(
        "stts",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(tableEntries),
          ...(hasSample ? [uint32Bytes(1), uint32Bytes(1000)] : []),
        ]),
      ),
      isoBox(
        "stsc",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(tableEntries),
          ...(hasSample
            ? [uint32Bytes(1), uint32Bytes(1), uint32Bytes(1)]
            : []),
        ]),
      ),
      isoBox(
        "stsz",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(hasSample ? mediaData.length : 0),
          uint32Bytes(sampleCount),
        ]),
      ),
      isoBox(
        "stco",
        Buffer.concat([
          Buffer.alloc(4),
          uint32Bytes(tableEntries),
          ...(hasSample ? [uint32Bytes(sampleOffset)] : []),
        ]),
      ),
    ]),
  );
  const track = isoBox(
    "trak",
    Buffer.concat([
      isoBox("tkhd", Buffer.alloc(84)),
      isoBox(
        "mdia",
        Buffer.concat([
          isoBox("mdhd", Buffer.alloc(24)),
          isoBox(
            "hdlr",
            Buffer.concat([
              Buffer.alloc(8),
              Buffer.from("vide"),
              Buffer.alloc(12),
            ]),
          ),
          isoBox("minf", stbl),
        ]),
      ),
    ]),
  );
  const moov = isoBox(
    "moov",
    Buffer.concat([isoBox("mvhd", Buffer.alloc(100)), track]),
  );
  return Buffer.concat([ftyp, mdat, moov]);
}

function makeFragmentedMp4Video(
  options: {
    dataOffset?: number;
    tfhdTrackId?: number;
    defaultSampleSize?: number;
    includeAvcConfiguration?: boolean;
  } = {},
): Buffer {
  const ftyp = isoBox(
    "ftyp",
    Buffer.concat([Buffer.from("isom"), uint32Bytes(0), Buffer.from("isom")]),
  );
  const trackHeader = Buffer.alloc(84);
  trackHeader.writeUInt32BE(1, 12);
  const sampleDescription = makeAvcSampleDescription(
    options.includeAvcConfiguration,
  );
  const sampleTable = isoBox(
    "stbl",
    Buffer.concat([
      isoBox(
        "stsd",
        Buffer.concat([Buffer.alloc(4), uint32Bytes(1), sampleDescription]),
      ),
      isoBox("stts", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
      isoBox("stsc", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
      isoBox(
        "stsz",
        Buffer.concat([Buffer.alloc(4), uint32Bytes(0), uint32Bytes(0)]),
      ),
      isoBox("stco", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
    ]),
  );
  const track = isoBox(
    "trak",
    Buffer.concat([
      isoBox("tkhd", trackHeader),
      isoBox(
        "mdia",
        Buffer.concat([
          isoBox("mdhd", Buffer.alloc(24)),
          isoBox(
            "hdlr",
            Buffer.concat([
              Buffer.alloc(8),
              Buffer.from("vide"),
              Buffer.alloc(12),
            ]),
          ),
          isoBox("minf", sampleTable),
        ]),
      ),
    ]),
  );
  const movieExtends = isoBox(
    "mvex",
    isoBox(
      "trex",
      Buffer.concat([
        Buffer.alloc(4),
        uint32Bytes(1),
        uint32Bytes(1),
        uint32Bytes(1000),
        uint32Bytes(options.defaultSampleSize ?? 4),
        uint32Bytes(0),
      ]),
    ),
  );
  const moov = isoBox(
    "moov",
    Buffer.concat([isoBox("mvhd", Buffer.alloc(100)), track, movieExtends]),
  );
  const makeMoof = (dataOffset: number) =>
    isoBox(
      "moof",
      Buffer.concat([
        isoBox("mfhd", Buffer.concat([Buffer.alloc(4), uint32Bytes(1)])),
        isoBox(
          "traf",
          Buffer.concat([
            isoBox(
              "tfhd",
              Buffer.concat([
                Buffer.from([0x00, 0x02, 0x00, 0x00]),
                uint32Bytes(options.tfhdTrackId ?? 1),
              ]),
            ),
            isoBox("tfdt", Buffer.concat([Buffer.alloc(4), uint32Bytes(0)])),
            isoBox(
              "trun",
              Buffer.concat([
                Buffer.from([0x00, 0x00, 0x00, 0x01]),
                uint32Bytes(1),
                uint32Bytes(dataOffset),
              ]),
            ),
          ]),
        ),
      ]),
    );
  const initialMoof = makeMoof(0);
  const dataOffset = options.dataOffset ?? initialMoof.length + 8;
  const moof = makeMoof(dataOffset);
  const mdat = isoBox("mdat", Buffer.from([0, 0, 0, 1]));
  return Buffer.concat([ftyp, moov, moof, mdat]);
}

function ebmlId(id: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(id);
  let first = 0;
  while (first < 3 && bytes[first] === 0) first++;
  return bytes.subarray(first);
}

function ebmlSize(size: number): Buffer {
  if (size < 0x7f) return Buffer.from([0x80 | size]);
  if (size < 0x3fff) {
    return Buffer.from([0x40 | (size >> 8), size & 0xff]);
  }
  throw new Error("Test EBML element is too large");
}

function ebmlElement(
  id: number,
  payload: Uint8Array,
  unknownSize = false,
): Buffer {
  return Buffer.concat([
    ebmlId(id),
    unknownSize ? Buffer.from([0xff]) : ebmlSize(payload.length),
    payload,
  ]);
}

function ebmlInteger(id: number, value: number, width = 1): Buffer {
  const payload = Buffer.alloc(width);
  for (let index = width - 1; index >= 0; index--) {
    payload[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return ebmlElement(id, payload);
}

function makeWebmVideo(
  options: {
    unknownSegmentSize?: boolean;
    unknownClusterSize?: boolean;
    duplicateInfoAfterCluster?: boolean;
    nestedInfoInBlockGroup?: boolean;
    segmentSiblingTagsAfterCluster?: boolean;
  } = {},
): Buffer {
  const info = ebmlElement(
    0x1549a966,
    Buffer.concat([
      ebmlInteger(0x2ad7b1, 1_000_000, 3),
      ebmlElement(0x4d80, Buffer.from("Slides test")),
      ebmlElement(0x5741, Buffer.from("Slides test")),
    ]),
  );
  const video = ebmlElement(
    0xe0,
    Buffer.concat([ebmlInteger(0xb0, 16), ebmlInteger(0xba, 16)]),
  );
  const track = ebmlElement(
    0xae,
    Buffer.concat([
      ebmlInteger(0xd7, 1),
      ebmlInteger(0x73c5, 1),
      ebmlInteger(0x83, 1),
      ebmlElement(0x86, Buffer.from("V_VP8")),
      video,
    ]),
  );
  const tracks = ebmlElement(0x1654ae6b, track);
  const block = Buffer.from([0x81, 0x00, 0x00, 0x80, 0x01]);
  const cluster = ebmlElement(
    0x1f43b675,
    Buffer.concat([
      ebmlInteger(0xe7, 0),
      options.nestedInfoInBlockGroup
        ? ebmlElement(0xa0, Buffer.concat([ebmlElement(0xa1, block), info]))
        : ebmlElement(0xa3, block),
    ]),
    options.unknownClusterSize,
  );
  const tags = ebmlElement(
    0x1254c367,
    ebmlElement(
      0x7373,
      ebmlElement(
        0x67c8,
        Buffer.concat([
          ebmlElement(0x45a3, Buffer.from("Slides")),
          ebmlElement(0x4487, Buffer.from("Video")),
        ]),
      ),
    ),
  );
  const segment = ebmlElement(
    0x18538067,
    Buffer.concat([
      info,
      tracks,
      cluster,
      ...(options.segmentSiblingTagsAfterCluster ? [tags] : []),
      ...(options.duplicateInfoAfterCluster ? [info] : []),
    ]),
    options.unknownSegmentSize,
  );
  const header = ebmlElement(
    0x1a45dfa3,
    Buffer.concat([
      ebmlInteger(0x4286, 1),
      ebmlInteger(0x42f7, 1),
      ebmlInteger(0x42f2, 4),
      ebmlInteger(0x42f3, 8),
      ebmlElement(0x4282, Buffer.from("webm")),
      ebmlInteger(0x4287, 2),
      ebmlInteger(0x4285, 2),
    ]),
  );
  return Buffer.concat([header, segment]);
}

describe("uploaded video validation", () => {
  const mp4 = makeMp4Video();
  const fragmentedMp4 = makeFragmentedMp4Video();
  const webm = makeWebmVideo();

  it("accepts structurally complete containers and rejects mismatched extensions", () => {
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.mp4", data: mp4 }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.webm", data: webm }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: fragmentedMp4,
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
        }),
      }),
    ).toBe(true);
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.mp4", data: webm }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({ originalName: "clip.mov", data: mp4 }),
    ).toBe(false);
  });

  it("requires MP4 sample data ranges and AVC sample descriptions", () => {
    const malformedMp4 = Buffer.from(mp4);
    malformedMp4[3] = 0xff;

    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeMp4Video({ hasSample: false }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeMp4Video({ sampleOffset: mp4.length }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: malformedMp4,
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeMp4Video({ includeAvcConfiguration: false }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ dataOffset: 0 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ tfhdTrackId: 2 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ defaultSampleSize: 0 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ defaultSampleSize: 5 }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: makeFragmentedMp4Video({ includeAvcConfiguration: false }),
      }),
    ).toBe(false);
  });

  it("rejects truncated containers and unknown-size clusters that swallow siblings", () => {
    const signatureOnlyMp4 = Buffer.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0,
    ]);
    const signatureOnlyWebm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: signatureOnlyMp4,
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: signatureOnlyWebm,
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.mp4",
        data: mp4.subarray(0, 100),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: webm.subarray(0, 100),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
          duplicateInfoAfterCluster: true,
        }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
          nestedInfoInBlockGroup: true,
        }),
      }),
    ).toBe(false);
    expect(
      canSaveAsUploadedVideoAsset({
        originalName: "clip.webm",
        data: makeWebmVideo({
          unknownSegmentSize: true,
          unknownClusterSize: true,
          segmentSiblingTagsAfterCluster: true,
        }),
      }),
    ).toBe(true);
  });

  it("stores video files in the configured object storage with the active org", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "uploads/provider-object-1.mp4",
      url: "https://cdn.example.com/clip.mp4",
    });

    const uploaded = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
    });
    expect(uploaded).toMatchObject({
      filename: "clip.mp4",
      type: "video/mp4",
      size: mp4.length,
      url: "https://cdn.example.com/clip.mp4",
    });
    expect(uploaded.id).not.toBe("uploads/provider-object-1.mp4");
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: uploaded.id,
        providerObjectId: "uploads/provider-object-1.mp4",
        orgId: "active-org",
      }),
    );

    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        data: mp4,
        filename: "clip.mp4",
        mimeType: "video/mp4",
        ownerEmail: "owner@example.com",
      }),
    );
    expect(mockReserveUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: uploaded.id,
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      }),
    );
    expect(
      mockReserveUploadedAssetRegistration.mock.invocationCallOrder[0],
    ).toBeLessThan(mockUploadFile.mock.invocationCallOrder[0]);
    expect(mockRecordUploadedAssetCleanupObject).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: uploaded.id,
        provider: "s3",
        providerObjectId: "uploads/provider-object-1.mp4",
      }),
      "registration-token",
    );
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "active-org" },
      expect.any(Function),
    );
  });

  it("passes video registration through the deck-scoped transaction helper", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");

    const asset = await uploadVideoAsset({
      email: "owner@example.com",
      orgId: "active-org",
      deckId: "deck-1",
      originalName: "clip.mp4",
      data: mp4,
    });

    expect(mockRegisterDeckUploadedAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        deckId: "deck-1",
        email: "owner@example.com",
        orgId: "active-org",
        row: expect.objectContaining({
          id: asset.id,
          deckId: "deck-1",
          orgId: "active-org",
        }),
      }),
    );
    expect(
      mockReserveUploadedAssetRegistration.mock.invocationCallOrder[0],
    ).toBeLessThan(mockUploadFile.mock.invocationCallOrder[0]);
    expect(mockValues).not.toHaveBeenCalled();
  });

  it("uses the trusted reservation when the deck disappears before registration", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "video-object-1",
      url: "https://cdn.example.com/clip.mp4",
    });
    mockRegisterDeckUploadedAsset.mockRejectedValueOnce(
      Object.assign(new Error("Deck not found."), {
        errorCode: "deck_not_found",
        statusCode: 404,
      }),
    );

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        orgId: "active-org",
        deckId: "deck-1",
        originalName: "clip.mp4",
        data: mp4,
      }),
    ).rejects.toMatchObject({
      errorCode: "deck_not_found",
      statusCode: 404,
    });

    expect(mockValues).not.toHaveBeenCalled();
    expect(mockClaimFailedUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.any(String),
        ownerEmail: "owner@example.com",
        orgId: "active-org",
        provider: "s3",
        providerObjectId: "video-object-1",
      }),
      "registration-token",
    );
    expect(
      mockClaimFailedUploadedAssetRegistration.mock.invocationCallOrder[0],
    ).toBeLessThan(mockDeleteUploadedFile.mock.invocationCallOrder[0]);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "video-object-1",
      url: "https://cdn.example.com/clip.mp4",
    });
  });

  it("normalizes provider diagnostics from failed video uploads", async () => {
    mockUploadFile.mockRejectedValueOnce(
      new Error("provider-secret-region and private storage endpoint"),
    );

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
      }),
    ).rejects.toMatchObject({
      message: "Video storage is temporarily unavailable. Try again.",
      errorCode: "video_upload_storage_failed",
      statusCode: 502,
    });

    expect(mockValues).not.toHaveBeenCalled();
    expect(mockReserveUploadedAssetRegistration).toHaveBeenCalledOnce();
    expect(
      mockReserveUploadedAssetRegistration.mock.invocationCallOrder[0],
    ).toBeLessThan(mockUploadFile.mock.invocationCallOrder[0]);
    expect(mockParkUnresolvedUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "registration-token",
    );
  });

  it("returns a typed error when video storage is not configured", async () => {
    mockUploadFile.mockResolvedValueOnce(null);

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
      }),
    ).rejects.toMatchObject({
      message:
        "No object storage is connected. Connect file storage before uploading videos.",
      errorCode: "video_upload_storage_unavailable",
      statusCode: 503,
    });

    expect(mockValues).not.toHaveBeenCalled();
    expect(mockCancelUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "registration-token",
    );
  });

  it("returns the existing uploaded video for a completed upload session", async () => {
    const completed = {
      id: "video-asset-1",
      filename: "clip.mp4",
      url: "https://cdn.example.com/clip.mp4",
      type: "video/mp4",
      size: 4,
      provider: "s3",
    };
    mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([completed]);
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "uploads/provider-object-1.mp4",
      url: completed.url,
    });

    const first = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
      uploadSessionId: "session-1",
    });
    const replay = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
      uploadSessionId: "session-1",
    });

    expect(replay).toEqual(completed);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: first.id,
        ownerEmail: "owner@example.com",
        uploadSessionId: "session-1",
      }),
    );
  });

  it("scopes completed upload lookup to the authenticated owner", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockSelectLimit.mockResolvedValueOnce([]);

    await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
      uploadSessionId: "session-1",
    });

    expect(mockSelectLimit).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith(
      mockUploadedAssets.ownerEmail,
      "owner@example.com",
    );
    expect(mockEq).toHaveBeenCalledWith(
      mockUploadedAssets.uploadSessionId,
      "session-1",
    );
    expect(mockEq).toHaveBeenCalledWith(mockUploadedAssets.orgId, "active-org");
  });

  it("cleans a provider object when the asset row insert fails", async () => {
    const insertError = new Error("asset row insert failed");
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "provider-object-1",
      url: "https://cdn.example.com/clip.mp4",
    });
    mockValues.mockRejectedValueOnce(insertError);

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
        uploadSessionId: "session-1",
      }),
    ).rejects.toMatchObject({
      message: "The uploaded video couldn't be saved. Try again.",
      errorCode: "video_asset_registration_failed",
      statusCode: 500,
    });

    expect(mockReserveUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: expect.any(String),
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      }),
    );
    expect(mockRecordUploadedAssetCleanupObject).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "s3",
        providerObjectId: "provider-object-1",
        url: "https://cdn.example.com/clip.mp4",
      }),
      "registration-token",
    );
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "provider-object-1",
      url: "https://cdn.example.com/clip.mp4",
    });
    expect(mockRunWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "active-org" },
      expect.any(Function),
    );
    expect(mockClaimFailedUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "registration-token",
    );
    expect(mockFinishOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assetId: expect.any(String) }),
      "deletion-token",
    );
  });

  it("keeps video cleanup queued when provider deletion fails", async () => {
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "provider-object-1",
      url: "https://cdn.example.com/clip.mp4",
    });
    mockValues.mockRejectedValueOnce(new Error("asset row insert failed"));
    mockSelectLimit.mockResolvedValueOnce([]);
    mockDeleteUploadedFile.mockResolvedValueOnce(false);

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
      }),
    ).rejects.toMatchObject({ errorCode: "video_asset_registration_failed" });

    expect(mockReserveUploadedAssetRegistration).toHaveBeenCalledOnce();
    expect(mockClaimFailedUploadedAssetRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "registration-token",
    );
    expect(mockDeleteUploadedFile).toHaveBeenCalledOnce();
    expect(mockRetryOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "deletion-token",
      1,
    );
    expect(mockFinishOwnedUploadedAssetCleanup).not.toHaveBeenCalled();
  });

  it("returns the winning upload when a concurrent insert already committed", async () => {
    const completed = {
      id: "video-asset-1",
      filename: "clip.mp4",
      url: "https://cdn.example.com/clip.mp4",
      type: "video/mp4",
      size: 4,
      provider: "s3",
    };
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockSelectLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([completed]);
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "duplicate-provider-object",
      url: "https://cdn.example.com/duplicate.mp4",
    });
    mockValues.mockRejectedValueOnce(new Error("unique constraint conflict"));

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
        uploadSessionId: "session-1",
      }),
    ).resolves.toEqual(completed);
    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("s3", {
      id: "duplicate-provider-object",
      url: "https://cdn.example.com/duplicate.mp4",
    });
  });

  it("keeps an asset when its insert committed but its acknowledgement was lost", async () => {
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockSelectLimit.mockResolvedValueOnce([]);
    mockValues.mockImplementationOnce(
      async (inserted: Record<string, unknown>) => {
        mockSelectLimit.mockResolvedValueOnce([
          {
            id: inserted.id,
            filename: inserted.filename,
            url: inserted.url,
            type: inserted.type,
            size: inserted.size,
            provider: inserted.provider,
          },
        ]);
        throw new Error("insert acknowledgement was lost");
      },
    );

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
        uploadSessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      filename: "clip.mp4",
      type: "video/mp4",
      url: "https://cdn.builder.io/logo.svg",
    });

    expect(mockClearRegisteredUploadedAsset).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "registration-token",
    );
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("does not delete a multipart object when its insert result cannot be checked", async () => {
    const insertError = new Error("insert acknowledgement was lost");
    mockGetRequestOrgId.mockReturnValue("active-org");
    mockUploadFile.mockResolvedValue({
      provider: "s3",
      id: "provider-object-1",
      url: "https://cdn.example.com/clip.mp4",
    });
    mockSelectLimit.mockRejectedValueOnce(new Error("database unavailable"));
    mockValues.mockRejectedValueOnce(insertError);

    await expect(
      uploadVideoAsset({
        email: "owner@example.com",
        originalName: "clip.mp4",
        data: mp4,
      }),
    ).rejects.toMatchObject({
      message: "The uploaded video couldn't be saved. Try again.",
      errorCode: "video_asset_registration_failed",
      statusCode: 500,
    });

    expect(mockClaimFailedUploadedAssetRegistration).not.toHaveBeenCalled();
    expect(mockClearRegisteredUploadedAsset).not.toHaveBeenCalled();
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("keeps a committed multipart upload when its insert acknowledgement is lost", async () => {
    mockValues.mockImplementationOnce(
      async (inserted: Record<string, unknown>) => {
        mockSelectLimit.mockResolvedValueOnce([
          {
            id: inserted.id,
            filename: inserted.filename,
            url: inserted.url,
            type: inserted.type,
            size: inserted.size,
            provider: inserted.provider,
          },
        ]);
        throw new Error("insert acknowledgement was lost");
      },
    );

    const result = await uploadVideoAsset({
      email: "owner@example.com",
      originalName: "clip.mp4",
      data: mp4,
    });

    expect(result).toMatchObject({
      filename: "clip.mp4",
      type: "video/mp4",
      url: "https://cdn.builder.io/logo.svg",
    });
    expect(mockClearRegisteredUploadedAsset).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: expect.any(String) }),
      "registration-token",
    );
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("ignores forged app-state cleanup receipts", async () => {
    const forgedKey = "slides-2:slides-upload-orphan-video-asset-forged";
    const forgedReceipt = {
      version: 1,
      ownerEmail: "owner@example.com",
      orgId: "active-org",
      assetId: "asset-1",
      provider: "attacker-provider",
      providerObjectId: "another-users-object",
      url: "https://attacker.example.com/arbitrary-object",
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    mockListOrphanedUploadedAssetCleanupKeys.mockResolvedValueOnce([
      { sessionId: "owner@example.com", key: forgedKey },
    ]);
    mockAppStateGetManyEntries.mockResolvedValueOnce([
      { key: forgedKey, value: forgedReceipt },
    ]);
    mockListOrphanedVideoAssetCleanups.mockResolvedValueOnce([
      { key: forgedKey, cleanup: forgedReceipt },
    ]);

    await reapOrphanedVideoAssetObjects("owner@example.com", "active-org");

    expect(mockAppStateGetManyEntries).not.toHaveBeenCalled();
    expect(mockCompareAndSetAppState).not.toHaveBeenCalled();
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("deletes from a claimed SQL outbox row and its lease", async () => {
    const candidate = {
      id: "asset-1",
      ownerEmail: "owner@example.com",
      orgId: "active-org",
      intent: "delete",
      state: "pending",
      provider: "trusted-storage",
      providerObjectId: "objects/authorized-image.png",
      url: "https://storage.example.com/authorized-image.png",
      attemptCount: 1,
      nextAttemptAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    const claimed = {
      ...candidate,
      state: "claimed",
      attemptCount: 2,
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-10-19T00:05:00.000Z",
    };
    mockListDueUploadedAssetCleanups.mockResolvedValueOnce([candidate]);
    mockClaimDueUploadedAssetCleanup.mockResolvedValueOnce(claimed);
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "asset-1",
        url: "https://storage.example.com/authorized-image.png",
        provider: "trusted-storage",
        providerObjectId: "objects/authorized-image.png",
        deckId: null,
      },
    ]);

    await reapOrphanedUploadedAssetObjects("owner@example.com", "active-org");

    expect(mockDeleteUploadedFile).toHaveBeenCalledWith("trusted-storage", {
      id: "objects/authorized-image.png",
      url: "https://storage.example.com/authorized-image.png",
    });
    expect(mockFinishOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      expect.anything(),
      {
        assetId: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      },
      "lease-1",
    );
    expect(mockAppStateGetManyEntries).not.toHaveBeenCalled();
  });

  it("retries a claimed cleanup when its SQL asset lookup is uncertain", async () => {
    const candidate = {
      id: "asset-1",
      ownerEmail: "owner@example.com",
      orgId: "active-org",
      intent: "delete",
      state: "pending",
      provider: "trusted-storage",
      providerObjectId: "objects/authorized-image.png",
      url: "https://storage.example.com/authorized-image.png",
      attemptCount: 0,
      nextAttemptAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    mockListDueUploadedAssetCleanups.mockResolvedValueOnce([candidate]);
    mockClaimDueUploadedAssetCleanup.mockResolvedValueOnce({
      ...candidate,
      state: "claimed",
      attemptCount: 1,
      leaseToken: "lease-1",
    });
    mockSelectLimit.mockRejectedValueOnce(new Error("database unavailable"));

    await reapOrphanedUploadedAssetObjects("owner@example.com", "active-org");

    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
    expect(mockRetryOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      {
        assetId: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      },
      "lease-1",
      1,
    );
  });

  it("does not delete an asset that remains attached to a deck", async () => {
    const candidate = {
      id: "asset-1",
      ownerEmail: "owner@example.com",
      orgId: "active-org",
      intent: "delete",
      state: "pending",
      provider: "trusted-storage",
      providerObjectId: "objects/authorized-image.png",
      url: "https://storage.example.com/authorized-image.png",
      attemptCount: 0,
      nextAttemptAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    mockListDueUploadedAssetCleanups.mockResolvedValueOnce([candidate]);
    mockClaimDueUploadedAssetCleanup.mockResolvedValueOnce({
      ...candidate,
      state: "claimed",
      attemptCount: 1,
      leaseToken: "lease-1",
    });
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "asset-1",
        url: "https://storage.example.com/authorized-image.png",
        provider: "trusted-storage",
        providerObjectId: "objects/authorized-image.png",
        deckId: "deck-1",
      },
    ]);

    await reapOrphanedUploadedAssetObjects("owner@example.com", "active-org");

    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
    expect(mockRetryOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      {
        assetId: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      },
      "lease-1",
      1,
    );
  });

  it("preserves a provider object referenced by another uploaded asset row", async () => {
    const candidate = {
      id: "deck-asset",
      ownerEmail: "owner@example.com",
      orgId: "active-org",
      intent: "delete",
      state: "pending",
      provider: "trusted-storage",
      providerObjectId: "objects/shared-image.png",
      url: "https://storage.example.com/shared-image.png",
      attemptCount: 0,
      nextAttemptAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
      createdAt: "2026-10-19T00:00:00.000Z",
    };
    mockListDueUploadedAssetCleanups.mockResolvedValueOnce([candidate]);
    mockClaimDueUploadedAssetCleanup.mockResolvedValueOnce({
      ...candidate,
      state: "claimed",
      attemptCount: 1,
      leaseToken: "lease-1",
    });
    mockSelectLimit
      .mockResolvedValueOnce([
        {
          id: "deck-asset",
          url: candidate.url,
          provider: candidate.provider,
          providerObjectId: candidate.providerObjectId,
          deckId: null,
        },
      ])
      .mockResolvedValueOnce([{ id: "global-asset-alias" }]);

    await reapOrphanedUploadedAssetObjects("owner@example.com", "active-org");

    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
    expect(mockFinishOwnedUploadedAssetCleanup).toHaveBeenCalledWith(
      expect.anything(),
      {
        assetId: "deck-asset",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      },
      "lease-1",
    );
    expect(mockRetryOwnedUploadedAssetCleanup).not.toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalledOnce();
  });

  it("clears a registered reservation only after its SQL asset row exists", async () => {
    mockListRegisteredUploadedAssetCleanups.mockResolvedValueOnce([
      {
        id: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
        intent: "registration",
        state: "registered",
        provider: "trusted-storage",
        providerObjectId: "objects/authorized-image.png",
        url: "https://storage.example.com/authorized-image.png",
        attemptCount: 0,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: "registration-token",
        createdAt: "2026-10-19T00:00:00.000Z",
      },
    ]);
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "asset-1",
        url: "https://storage.example.com/authorized-image.png",
        provider: "trusted-storage",
        providerObjectId: "objects/authorized-image.png",
        deckId: "deck-1",
      },
    ]);

    await reapOrphanedUploadedAssetObjects("owner@example.com", "active-org");

    expect(mockClearRegisteredUploadedAsset).toHaveBeenCalledWith(
      {
        assetId: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
      },
      "registration-token",
    );
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });

  it("preserves a registered cleanup marker when the asset now points at a different object", async () => {
    mockListRegisteredUploadedAssetCleanups.mockResolvedValueOnce([
      {
        id: "asset-1",
        ownerEmail: "owner@example.com",
        orgId: "active-org",
        intent: "registration",
        state: "registered",
        provider: "trusted-storage",
        providerObjectId: "objects/old-image.png",
        url: "https://storage.example.com/old-image.png",
        attemptCount: 0,
        nextAttemptAt: null,
        leaseExpiresAt: null,
        leaseToken: "registration-token",
        createdAt: "2026-10-19T00:00:00.000Z",
      },
    ]);
    mockSelectLimit.mockResolvedValueOnce([
      {
        id: "asset-1",
        url: "https://storage.example.com/replacement.png",
        provider: "trusted-storage",
        providerObjectId: "objects/replacement.png",
        deckId: null,
      },
    ]);

    await expect(
      reapOrphanedUploadedAssetObjects("owner@example.com", "active-org"),
    ).resolves.toEqual({ failedAttempts: 1 });

    expect(mockClearRegisteredUploadedAsset).not.toHaveBeenCalled();
    expect(mockDeleteUploadedFile).not.toHaveBeenCalled();
  });
});

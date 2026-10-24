import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userEmail: "editor@example.test" as string | undefined,
  documentRows: [] as Array<{ visibility: string; trashedAt: string | null }>,
  resolveDocumentAccess: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
  requestClipsUpload: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.userEmail,
  getRequestUserName: () => "Eden Editor",
  getRequestOrgId: () => "org_1",
}));

vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));

vi.mock("./_document-access.js", () => ({
  resolveDocumentAccess: mocks.resolveDocumentAccess,
}));

vi.mock("../server/db/index.js", () => ({
  schema: { documents: { id: "id", visibility: "visibility", trashedAt: "t" } },
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.documentRows }),
      }),
    }),
  }),
}));

vi.mock("../server/lib/clips-peer.js", () => ({
  requestClipsUpload: mocks.requestClipsUpload,
  clipsLinkOrigins: () => [
    "https://clips.example.test",
    "https://beta.clips.example.test",
  ],
}));

import createClipUpload from "./create-clip-upload";
import getClipUploadStatus from "./get-clip-upload-status";

const PUBLIC_VIEWER =
  "public-0f8fad5b-d9cb-469f-a165-70867728950e@agent-native.local";
const start = {
  documentId: "doc_1",
  fileName: "  Team demo.mp4 ",
  sizeBytes: 5_000_000,
  mimeType: "video/mp4" as const,
  blockId: "block_1",
};
const ticket = {
  recordingId: "rec_1",
  chunkUrl:
    "https://clips.example.test/api/uploads/rec_1/content-chunk?mimeType=video%2Fmp4&total=2&ticket=t",
  chunkSizeBytes: 4_194_304,
  totalChunks: 2,
  expiresAt: "2026-10-24T12:00:00.000Z",
};
const withIp = {
  requestHeaders: new Headers({ "x-nf-client-connection-ip": "203.0.113.7" }),
} as never;

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.userEmail = "editor@example.test";
  mocks.documentRows = [{ visibility: "private", trashedAt: null }];
  mocks.resolveDocumentAccess.mockResolvedValue({ role: "editor" });
  mocks.isFeatureFlagEnabled.mockResolvedValue(true);
  mocks.requestClipsUpload.mockResolvedValue({
    ok: true,
    status: 200,
    body: ticket,
  });
});

describe("who may upload a Clip into a page", () => {
  const runs = {
    status: () => getClipUploadStatus.run({ documentId: "doc_1" }),
    start: () => createClipUpload.run(start),
  };

  it.each(["status", "start"] as const)(
    "%s: refuses a reader who can't edit the page before asking Clips",
    async (kind) => {
      for (const role of ["viewer", "commenter"]) {
        mocks.resolveDocumentAccess.mockResolvedValue({ role });
        await expect(failureOf(runs[kind]())).resolves.toEqual({
          errorCode: "document_edit_required",
          statusCode: 403,
        });
      }
      expect(mocks.isFeatureFlagEnabled).not.toHaveBeenCalled();
      expect(mocks.requestClipsUpload).not.toHaveBeenCalled();
    },
  );

  it.each(["status", "start"] as const)(
    "%s: refuses a page the caller can't read, a page in Trash, and a signed-out caller",
    async (kind) => {
      mocks.resolveDocumentAccess.mockResolvedValueOnce(null);
      await expect(failureOf(runs[kind]())).resolves.toMatchObject({
        errorCode: "document_not_found",
      });

      mocks.documentRows = [
        { visibility: "private", trashedAt: "2026-10-01T00:00:00Z" },
      ];
      await expect(failureOf(runs[kind]())).resolves.toMatchObject({
        errorCode: "document_not_found",
      });

      mocks.documentRows = [{ visibility: "public", trashedAt: null }];
      for (const email of [undefined, PUBLIC_VIEWER]) {
        mocks.userEmail = email;
        await expect(failureOf(runs[kind]())).resolves.toMatchObject({
          errorCode: "document_not_found",
        });
      }
      expect(mocks.requestClipsUpload).not.toHaveBeenCalled();
    },
  );

  it.each(["status", "start"] as const)(
    "%s: refuses while the Clip block's flag is off",
    async (kind) => {
      mocks.isFeatureFlagEnabled.mockResolvedValue(false);
      await expect(failureOf(runs[kind]())).resolves.toEqual({
        errorCode: "clip_embed_disabled",
        statusCode: 404,
      });
      expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
        expect.objectContaining({ key: "content.clip-embed" }),
        { userEmail: "editor@example.test", orgId: "org_1" },
      );
      expect(mocks.requestClipsUpload).not.toHaveBeenCalled();
    },
  );

  it("lets an owner or admin upload too", async () => {
    for (const role of ["owner", "admin"]) {
      mocks.resolveDocumentAccess.mockResolvedValue({ role });
      await expect(createClipUpload.run(start)).resolves.toMatchObject({
        status: "started",
      });
    }
  });
});

describe("get-clip-upload-status", () => {
  it.each([
    { state: "ready", provider: "builder" },
    { state: "ready", provider: "custom" },
    { state: "ready", provider: "local" },
    { state: "free", remaining: 2, limit: 3, maxClipBytes: 100_000_000 },
    { state: "used_up", limit: 3 },
    { state: "none", reason: "disabled" },
    { state: "account_required" },
  ])("shows what Clips says: %j", async (storage) => {
    mocks.requestClipsUpload.mockResolvedValue({
      ok: true,
      status: 200,
      body: { storage },
    });
    await expect(
      getClipUploadStatus.run({ documentId: "doc_1" }, withIp),
    ).resolves.toEqual({ storage });
    expect(mocks.requestClipsUpload).toHaveBeenCalledWith({
      uploader: {
        kind: "signed-in",
        email: "editor@example.test",
        name: "Eden Editor",
      },
      documentId: "doc_1",
      clientIp: "203.0.113.7",
    });
  });

  it("fails on a storage state it can't read, and passes Clips' own failures on", async () => {
    mocks.requestClipsUpload.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { storage: { state: "free", remaining: -1, limit: 3 } },
    });
    await expect(
      failureOf(getClipUploadStatus.run({ documentId: "doc_1" })),
    ).resolves.toMatchObject({ errorCode: "clip_upload_failed" });

    mocks.requestClipsUpload.mockResolvedValueOnce({
      ok: false,
      code: "clips_not_configured",
    });
    await expect(
      failureOf(getClipUploadStatus.run({ documentId: "doc_1" })),
    ).resolves.toEqual({ errorCode: "clips_not_configured", statusCode: 503 });
  });

  it("sends no address it can't trust", async () => {
    mocks.requestClipsUpload.mockResolvedValue({
      ok: true,
      status: 200,
      body: { storage: { state: "account_required" } },
    });
    await getClipUploadStatus.run({ documentId: "doc_1" }, {
      requestHeaders: new Headers({ "x-forwarded-for": "198.51.100.1" }),
    } as never);
    expect(mocks.requestClipsUpload).toHaveBeenCalledWith(
      expect.objectContaining({ clientIp: null }),
    );
  });
});

describe("create-clip-upload", () => {
  it("returns Clips' ticket and sends only the file's description", async () => {
    await expect(createClipUpload.run(start, withIp)).resolves.toEqual({
      status: "started",
      ...ticket,
    });
    expect(mocks.requestClipsUpload).toHaveBeenCalledWith({
      uploader: {
        kind: "signed-in",
        email: "editor@example.test",
        name: "Eden Editor",
      },
      documentId: "doc_1",
      clientIp: "203.0.113.7",
      start: {
        fileName: "Team demo.mp4",
        sizeBytes: 5_000_000,
        mimeType: "video/mp4",
        blockId: "block_1",
      },
    });
  });

  it("takes a ticket on Clips' other lane", async () => {
    const chunkUrl = ticket.chunkUrl.replace(
      "clips.example.test",
      "beta.clips.example.test",
    );
    mocks.requestClipsUpload.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ...ticket, chunkUrl },
    });
    await expect(createClipUpload.run(start)).resolves.toMatchObject({
      chunkUrl,
    });
  });

  it.each([
    [
      "another origin",
      "https://elsewhere.example.test/api/uploads/rec_1/content-chunk?ticket=t",
    ],
    [
      "another recording",
      "https://clips.example.test/api/uploads/rec_2/content-chunk?ticket=t",
    ],
    [
      "another route",
      "https://clips.example.test/api/uploads/rec_1/agent-chunk?ticket=t",
    ],
    ["no ticket", "https://clips.example.test/api/uploads/rec_1/content-chunk"],
    [
      "credentials",
      "https://user:pw@clips.example.test/api/uploads/rec_1/content-chunk?ticket=t",
    ],
  ])("refuses a chunk URL with %s", async (_label, chunkUrl) => {
    mocks.requestClipsUpload.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ...ticket, chunkUrl },
    });
    await expect(failureOf(createClipUpload.run(start))).resolves.toEqual({
      errorCode: "clip_upload_failed",
      statusCode: 502,
    });
  });

  it("answers with the storage Clips needs", async () => {
    const storage = { state: "used_up", limit: 3 };
    mocks.requestClipsUpload.mockResolvedValue({
      ok: true,
      status: 409,
      body: { code: "storage_required", storage },
    });
    await expect(createClipUpload.run(start)).resolves.toEqual({
      status: "storage_required",
      storage,
    });
  });

  it("answers with the largest file Clips takes", async () => {
    mocks.requestClipsUpload.mockResolvedValue({
      ok: true,
      status: 413,
      body: { code: "upload_too_large", maxBytes: 1_000 },
    });
    await expect(createClipUpload.run(start)).resolves.toEqual({
      status: "too_large",
      maxBytes: 1_000,
    });
  });

  it("refuses a type Clips doesn't take, and a block id that can't be a URL segment, before asking", async () => {
    await expect(
      createClipUpload.run({ ...start, mimeType: "video/x-msvideo" as never }),
    ).rejects.toThrow();
    await expect(
      createClipUpload.run({ ...start, blockId: "a b" }),
    ).rejects.toThrow();
    expect(mocks.requestClipsUpload).not.toHaveBeenCalled();
  });

  it("passes on a refused token and a rate limit as their own codes", async () => {
    mocks.requestClipsUpload.mockResolvedValueOnce({
      ok: false,
      code: "clip_token_refused",
    });
    await expect(failureOf(createClipUpload.run(start))).resolves.toEqual({
      errorCode: "clip_token_refused",
      statusCode: 502,
    });
    mocks.requestClipsUpload.mockResolvedValueOnce({
      ok: false,
      code: "clip_rate_limited",
    });
    await expect(failureOf(createClipUpload.run(start))).resolves.toEqual({
      errorCode: "clip_rate_limited",
      statusCode: 429,
    });
  });
});

import { deflateSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  createDesign: vi.fn(),
  deleteDesign: vi.fn(),
  deleteAttachment: vi.fn(),
  mintAttachmentRef: vi.fn(),
  readMultipartFormData: vi.fn(),
  runWithRequestContext: vi.fn(),
  runAction: vi.fn(),
  resolveActiveOrgIdForStorageCredential: vi.fn(),
  getPrivateStorageReadinessForRequest: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  whereCalls: [] as { table: unknown; conditions: unknown[] }[],
  verifyA2AToken: vi.fn(),
  designsTable: {
    id: "designs.id",
    title: "designs.title",
    description: "designs.description",
    data: "designs.data",
    dataOperationRevisions: "designs.dataOperationRevisions",
    liveCollaborationEnabled: "designs.liveCollaborationEnabled",
    projectType: "designs.projectType",
    designSystemId: "designs.designSystemId",
    createdAt: "designs.createdAt",
    updatedAt: "designs.updatedAt",
    ownerEmail: "designs.ownerEmail",
    orgId: "designs.orgId",
    visibility: "designs.visibility",
  },
  createdShell: undefined as
    | {
        id: string;
        title: string;
        description: string;
        data: string;
        dataOperationRevisions: string;
        liveCollaborationEnabled: boolean;
        projectType: string;
        designSystemId: null;
        createdAt: string;
        updatedAt: string;
        ownerEmail: string;
        orgId: null;
        visibility: string;
      }
    | undefined,
}));

vi.mock("h3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("h3")>();
  return {
    ...actual,
    defineEventHandler: (handler: unknown) => handler,
    getHeader: (event: any, name: string) => event.req.headers.get(name),
    readMultipartFormData: (...args: unknown[]) =>
      mocks.readMultipartFormData(...args),
  };
});

vi.mock("@agent-native/core/a2a", () => ({
  verifyA2AToken: mocks.verifyA2AToken,
}));

vi.mock("@agent-native/core/action", () => ({
  isActionContractError: (error: unknown) =>
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { actionContractError?: unknown }).actionContractError ===
        true &&
      typeof (error as { errorCode?: unknown }).errorCode === "string",
    ),
}));

vi.mock("@agent-native/core/private-blob", () => ({
  deleteAttachment: mocks.deleteAttachment,
  mintAttachmentRef: mocks.mintAttachmentRef,
}));

vi.mock("@agent-native/core/org", () => ({
  resolveActiveOrgIdForStorageCredential:
    mocks.resolveActiveOrgIdForStorageCredential,
}));

vi.mock("@agent-native/core/file-upload", () => ({
  getPrivateStorageReadinessForRequest:
    mocks.getPrivateStorageReadinessForRequest,
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mocks.runWithRequestContext(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (...args: unknown[]) => mocks.eq(...args),
  isNull: (column: unknown) => ({ type: "isNull", column }),
}));

vi.mock("../../db/index.js", () => ({
  getDb: () => ({ select: (...args: unknown[]) => mocks.select(...args) }),
  schema: {
    designShares: { resourceId: "design-shares.resource-id" },
    designs: mocks.designsTable,
  },
}));

vi.mock("../../../actions/add-session-replay-screenshots-to-board.js", () => ({
  default: { run: mocks.runAction },
}));

vi.mock("../../../actions/create-design.js", () => ({
  default: { run: mocks.createDesign },
}));

vi.mock("../../../actions/delete-design.js", () => ({
  default: { run: mocks.deleteDesign },
}));

import handler from "./session-replay-storyboard.post";

const designId = "design-123";
const screenshot = {
  replayId: "sr_123",
  app: "clips",
  capturedAt: "2026-10-07T12:00:00.000Z",
  route: "/library",
  offsetMs: 1_250,
  viewportWidth: 2,
  viewportHeight: 1,
  eventCount: 3,
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
  designId: requestedDesignId = designId,
}: {
  screenshots?: Array<typeof screenshot>;
  pixelWidthOverride?: number;
  pngOverride?: Buffer;
  designId?: string | null;
} = {}) {
  const form = new FormData();
  const replayCount = new Set(screenshots.map(({ replayId }) => replayId)).size;
  form.set(
    "manifest",
    JSON.stringify({
      ...(requestedDesignId ? { designId: requestedDesignId } : {}),
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

function makeEvent(
  body: BodyInit,
  token = "test-a2a-token",
  signal?: AbortSignal,
) {
  return {
    req: new Request(
      "https://design.example.test/api/session-replay-storyboard",
      {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body,
        signal,
      },
    ),
  };
}

describe("POST /api/session-replay-storyboard", () => {
  beforeEach(() => {
    for (const mock of [
      mocks.assertAccess,
      mocks.createDesign,
      mocks.deleteDesign,
      mocks.deleteAttachment,
      mocks.mintAttachmentRef,
      mocks.readMultipartFormData,
      mocks.runAction,
      mocks.runWithRequestContext,
      mocks.resolveActiveOrgIdForStorageCredential,
      mocks.getPrivateStorageReadinessForRequest,
      mocks.select,
      mocks.eq,
      mocks.verifyA2AToken,
    ]) {
      mock.mockReset();
    }
    mocks.verifyA2AToken.mockResolvedValue({
      email: "ada@example.test",
    });
    mocks.resolveActiveOrgIdForStorageCredential.mockResolvedValue(null);
    mocks.getPrivateStorageReadinessForRequest.mockResolvedValue({
      selectedOrg: "none",
      provider: "builder",
      readiness: "ready",
      builderAuthorized: "yes",
    });
    mocks.runWithRequestContext.mockImplementation(
      async (_context: unknown, callback: () => unknown) => callback(),
    );
    mocks.assertAccess.mockResolvedValue({
      role: "editor",
      resource: {
        ownerEmail: "ada@example.test",
        orgId: null,
        visibility: "private",
      },
    });
    mocks.createDesign.mockResolvedValue({ id: designId });
    mocks.createdShell = {
      id: designId,
      title: "Session replay storyboard",
      description: "Private session replay storyboard from Analytics.",
      data: "{}",
      dataOperationRevisions: "{}",
      liveCollaborationEnabled: false,
      projectType: "prototype",
      designSystemId: null,
      createdAt: "2026-10-11T12:00:00.000Z",
      updatedAt: "2026-10-11T12:00:00.000Z",
      ownerEmail: "ada@example.test",
      orgId: null,
      visibility: "private",
    };
    mocks.deleteDesign.mockImplementation(async ({ id }) => {
      mocks.createdShell = undefined;
      return { id, deleted: true };
    });
    const query: {
      table: unknown;
      from: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
      limit: ReturnType<typeof vi.fn>;
    } = {
      table: undefined,
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    query.from.mockImplementation((table: unknown) => {
      query.table = table;
      return query;
    });
    query.where.mockImplementation((...conditions: unknown[]) => {
      mocks.whereCalls.push({ table: query.table, conditions });
      return query;
    });
    query.limit.mockImplementation(() =>
      Promise.resolve(
        query.table === mocks.designsTable && mocks.createdShell
          ? [mocks.createdShell]
          : [],
      ),
    );
    mocks.select.mockReturnValue(query);
    mocks.eq.mockImplementation((column: unknown, value: unknown) => ({
      type: "eq",
      column,
      value,
    }));
    mocks.mintAttachmentRef.mockResolvedValue({
      status: "ok",
      ref: "private-attachment-ref",
    });
    mocks.deleteAttachment.mockResolvedValue({ status: "ok", deleted: true });
    mocks.runAction.mockResolvedValue({
      boardUrl: "https://design.example.test/design/design-123",
      designId,
      screenshotCount: 1,
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

  it("verifies the Analytics user, writes through the existing Design action, and cleans the temporary ref", async () => {
    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result).toMatchObject({
      designId,
      screenshotCount: 1,
      selectedReplayCount: 1,
      cohortTotal: 1,
      cleanupPending: false,
    });
    expect(mocks.verifyA2AToken).toHaveBeenCalledWith(
      "test-a2a-token",
      expect.any(Object),
    );
    expect(mocks.assertAccess.mock.calls[0]).toEqual([
      "design",
      designId,
      "editor",
      undefined,
      { skipResourceBody: true },
    ]);
    expect(mocks.mintAttachmentRef).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "ada@example.test",
        orgId: null,
        data: expect.any(Buffer),
      }),
    );
    expect(mocks.runAction).toHaveBeenCalledWith(
      expect.objectContaining({
        designId,
        screenshots: [
          expect.objectContaining({ attachmentRef: "private-attachment-ref" }),
        ],
      }),
      expect.objectContaining({
        actionName: "add-session-replay-screenshots-to-board",
        userEmail: "ada@example.test",
        orgId: null,
      }),
    );
    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      {
        userEmail: "ada@example.test",
        orgId: undefined,
        orgScope: "personal",
      },
      expect.any(Function),
    );
    expect(mocks.runWithRequestContext).toHaveBeenNthCalledWith(
      2,
      {
        userEmail: "ada@example.test",
        orgId: undefined,
        orgScope: "personal",
        builderStorageCredentialOrgId: null,
      },
      expect.any(Function),
    );
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.deleteAttachment).toHaveBeenCalledWith(
      "private-attachment-ref",
      { ownerEmail: "ada@example.test", orgId: null },
    );
  });

  it("uses the selected org only for Builder storage while keeping the attachment personal", async () => {
    mocks.resolveActiveOrgIdForStorageCredential.mockResolvedValue("org-1");

    await (handler as any)(makeEvent(makeFormData({ designId: null })));

    const storageContext = {
      userEmail: "ada@example.test",
      orgId: undefined,
      orgScope: "personal",
      builderStorageCredentialOrgId: "org-1",
    };
    expect(mocks.runWithRequestContext).toHaveBeenNthCalledWith(
      2,
      storageContext,
      expect.any(Function),
    );
    expect(mocks.runWithRequestContext).toHaveBeenNthCalledWith(
      3,
      storageContext,
      expect.any(Function),
    );
    expect(mocks.runWithRequestContext).toHaveBeenNthCalledWith(
      4,
      storageContext,
      expect.any(Function),
    );
    expect(mocks.runWithRequestContext).toHaveBeenNthCalledWith(
      5,
      storageContext,
      expect.any(Function),
    );
    expect(
      mocks.getPrivateStorageReadinessForRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.createDesign.mock.invocationCallOrder[0]!);
    expect(
      mocks.runWithRequestContext.mock.invocationCallOrder[3],
    ).toBeLessThan(mocks.runAction.mock.invocationCallOrder[0]!);
    expect(mocks.runAction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runWithRequestContext.mock.invocationCallOrder[4]!,
    );
    expect(mocks.mintAttachmentRef).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "ada@example.test", orgId: null }),
    );
    expect(mocks.deleteAttachment).toHaveBeenCalledWith(
      "private-attachment-ref",
      { ownerEmail: "ada@example.test", orgId: null },
    );
    expect(mocks.runAction).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ orgId: null }),
    );
  });

  it("maps an unavailable active-org lookup to fixed storage failure before creating a board", async () => {
    mocks.resolveActiveOrgIdForStorageCredential.mockRejectedValueOnce(
      new Error("membership lookup failed"),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Design private screenshot storage is unavailable",
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("stops waiting for active-org selection when the request expires", async () => {
    let resolveLookup: (value: string | null) => void = () => {};
    mocks.resolveActiveOrgIdForStorageCredential.mockImplementationOnce(
      () =>
        new Promise<string | null>((resolve) => {
          resolveLookup = resolve;
        }),
    );
    const controller = new AbortController();
    const request = (handler as any)(
      makeEvent(
        makeFormData({ designId: null }),
        "test-a2a-token",
        controller.signal,
      ),
    );

    await vi.waitFor(() => {
      expect(
        mocks.resolveActiveOrgIdForStorageCredential,
      ).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      statusCode: 504,
      statusMessage: "Design screenshot upload request expired",
      data: { errorCode: "request_deadline_exceeded" },
    });
    resolveLookup(null);
    expect(mocks.getPrivateStorageReadinessForRequest).not.toHaveBeenCalled();
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("keeps a late active-org lookup rejection from replacing request expiry", async () => {
    let rejectLookup: (reason?: unknown) => void = () => {};
    mocks.resolveActiveOrgIdForStorageCredential.mockImplementationOnce(
      () =>
        new Promise<string | null>((_resolve, reject) => {
          rejectLookup = reject;
        }),
    );
    const controller = new AbortController();
    const request = (handler as any)(
      makeEvent(
        makeFormData({ designId: null }),
        "test-a2a-token",
        controller.signal,
      ),
    );

    await vi.waitFor(() => {
      expect(
        mocks.resolveActiveOrgIdForStorageCredential,
      ).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      statusCode: 504,
      statusMessage: "Design screenshot upload request expired",
      data: { errorCode: "request_deadline_exceeded" },
    });
    rejectLookup(new Error("late membership lookup failure"));
    await Promise.resolve();
    expect(mocks.getPrivateStorageReadinessForRequest).not.toHaveBeenCalled();
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("gates on private storage readiness before creating a board", async () => {
    mocks.getPrivateStorageReadinessForRequest.mockResolvedValueOnce({
      selectedOrg: "selected",
      provider: "none",
      readiness: "unavailable",
      builderAuthorized: "no",
    });

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Design private screenshot storage is unavailable",
      data: { errorCode: "private_storage_unavailable" },
    });
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("does not create a board when the request expires during storage readiness", async () => {
    const readiness = {
      selectedOrg: "none" as const,
      provider: "builder" as const,
      readiness: "ready" as const,
      builderAuthorized: "yes" as const,
    };
    let resolveReadiness: (value: typeof readiness) => void = () => {};
    mocks.getPrivateStorageReadinessForRequest.mockImplementationOnce(
      () =>
        new Promise<typeof readiness>((resolve) => {
          resolveReadiness = resolve;
        }),
    );
    const controller = new AbortController();
    const request = (handler as any)(
      makeEvent(
        makeFormData({ designId: null }),
        "test-a2a-token",
        controller.signal,
      ),
    );

    await vi.waitFor(() => {
      expect(mocks.getPrivateStorageReadinessForRequest).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({
      statusCode: 504,
      statusMessage: "Design screenshot upload request expired",
      data: { errorCode: "request_deadline_exceeded" },
    });
    resolveReadiness(readiness);
    expect(mocks.createDesign).not.toHaveBeenCalled();
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("captures and cleans a new board when the request expires during creation", async () => {
    let resolveCreate: (value: { id: string }) => void = () => {};
    mocks.createDesign.mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const controller = new AbortController();
    const request = (handler as any)(
      makeEvent(
        makeFormData({ designId: null }),
        "test-a2a-token",
        controller.signal,
      ),
    );

    await vi.waitFor(() => {
      expect(mocks.createDesign).toHaveBeenCalledOnce();
    });
    controller.abort();
    resolveCreate({ id: designId });

    const failure = await request.catch(
      (error: unknown) =>
        error as {
          statusCode?: number;
          statusMessage?: string;
          data?: Record<string, unknown>;
        },
    );
    expect(failure).toMatchObject({
      statusCode: 504,
      statusMessage: "Design screenshot upload request expired",
      data: { errorCode: "request_deadline_exceeded" },
    });
    expect(failure.data).not.toHaveProperty("saveOutcomeUnknown");
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.createDesign.mock.invocationCallOrder[0]!,
    );
    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        id: designId,
        expectedCreatedShell: expect.objectContaining({
          createdAt: "2026-10-11T12:00:00.000Z",
          updatedAt: "2026-10-11T12:00:00.000Z",
        }),
      }),
      expect.any(Object),
    );
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.deleteAttachment).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("cleans the minted ref and new board when the request expires during mint", async () => {
    const controller = new AbortController();
    const screenshots = [
      { ...screenshot, replayId: "sr_123" },
      { ...screenshot, replayId: "sr_456", offsetMs: 2_500 },
    ];
    mocks.mintAttachmentRef.mockImplementationOnce(async () => {
      controller.abort();
      return { status: "ok", ref: "private-attachment-ref" };
    });
    const request = (handler as any)(
      makeEvent(
        makeFormData({ designId: null, screenshots }),
        "test-a2a-token",
        controller.signal,
      ),
    );

    const failure = await request.catch(
      (error: unknown) =>
        error as {
          statusCode?: number;
          statusMessage?: string;
          data?: Record<string, unknown>;
        },
    );
    expect(failure).toMatchObject({
      statusCode: 504,
      statusMessage: "Design screenshot upload request expired",
      data: { errorCode: "request_deadline_exceeded" },
    });
    expect(failure.data).not.toHaveProperty("saveOutcomeUnknown");
    expect(mocks.mintAttachmentRef).toHaveBeenCalledOnce();
    expect(mocks.deleteAttachment).toHaveBeenCalledWith(
      "private-attachment-ref",
      { ownerEmail: "ada@example.test", orgId: null },
    );
    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        id: designId,
        expectedCreatedShell: expect.objectContaining({
          createdAt: "2026-10-11T12:00:00.000Z",
          updatedAt: "2026-10-11T12:00:00.000Z",
        }),
      }),
      expect.any(Object),
    );
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("rejects a missing signed Analytics user before parsing or writing", async () => {
    await expect(
      (handler as any)(makeEvent(makeFormData(), "")),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mocks.verifyA2AToken).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it.each([{ orgId: "org-1" }, { orgDomain: "workspace.example.test" }])(
    "rejects an organization-bound caller before parsing or writing",
    async (claims) => {
      mocks.verifyA2AToken.mockResolvedValueOnce({
        email: "ada@example.test",
        ...claims,
      });

      await expect(
        (handler as any)(makeEvent(makeFormData())),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mocks.readMultipartFormData).not.toHaveBeenCalled();
      expect(mocks.createDesign).not.toHaveBeenCalled();
      expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    },
  );

  it("creates a private board before attaching screenshots when no board is supplied", async () => {
    await (handler as any)(makeEvent(makeFormData({ designId: null })));
    expect(mocks.createDesign).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Session replay storyboard",
        projectType: "prototype",
        designSystemId: null,
        creationMethod: "import_analytics",
      }),
      expect.objectContaining({
        actionName: "create-design",
        userEmail: "ada@example.test",
        orgId: null,
      }),
    );
    expect(mocks.createDesign.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mintAttachmentRef.mock.invocationCallOrder[0]!,
    );
    expect(mocks.assertAccess.mock.calls[0]?.slice(0, 3)).toEqual([
      "design",
      designId,
      "editor",
    ]);
    expect(mocks.runAction).toHaveBeenCalledWith(
      expect.objectContaining({ designId }),
      expect.objectContaining({ orgId: null }),
    );
  });

  it("preserves a board already edited before its cleanup baseline is captured", async () => {
    mocks.createdShell = {
      ...mocks.createdShell!,
      updatedAt: "2026-10-11T12:01:00.000Z",
    };

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({
      statusCode: 502,
      data: { cleanupPending: true, cleanupUnknown: true },
    });

    expect(mocks.deleteDesign).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it.each([
    ["an organization-owned board", { orgId: "org-1" }],
    ["a shared board", { visibility: "org" }],
    ["another user's board", { ownerEmail: "other@example.test" }],
  ])("rejects %s before writing", async (_label, resource) => {
    mocks.assertAccess.mockResolvedValueOnce({
      role: "editor",
      resource: {
        ownerEmail: "ada@example.test",
        orgId: null,
        visibility: "private",
        ...resource,
      },
    });

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("rejects a board with explicit share rows before writing", async () => {
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn().mockResolvedValue([{ resourceId: designId }]),
    };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    mocks.select.mockReturnValueOnce(query);

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("preserves the oversized-request error when body cancellation fails", async () => {
    const reader = {
      cancel: vi
        .fn()
        .mockRejectedValue(new Error("stream cancellation failed")),
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(21 * 1024 * 1024),
      }),
      releaseLock: vi.fn(),
    };
    const event = {
      req: {
        body: { getReader: () => reader },
        headers: new Headers({ authorization: "Bearer test-a2a-token" }),
      },
    };

    await expect((handler as any)(event)).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: "Screenshot export request is too large",
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
  });

  it("rejects pixels whose dimensions differ from replay metadata", async () => {
    await expect(
      (handler as any)(makeEvent(makeFormData({ pixelWidthOverride: 3 }))),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: "Screenshot pixels do not match the replay viewport",
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it.each([
    ["a header-only PNG", pngBytes().subarray(0, 33)],
    ["corrupt compressed pixels", corruptPngData()],
    ["an out-of-range indexed palette pixel", pngWithInvalidPaletteIndex()],
  ])("rejects %s before persisting it", async (_label, pngOverride) => {
    await expect(
      (handler as any)(makeEvent(makeFormData({ pngOverride }))),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: "Screenshot pixels do not match the replay viewport",
    });
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
    expect(mocks.runAction).not.toHaveBeenCalled();
  });

  it("rejects a screenshot batch above the decoded pixel limit before writing", async () => {
    const screenshots = Array.from({ length: 5 }, (_, index) => ({
      ...screenshot,
      replayId: `sr_${index}`,
      viewportWidth: 4_000,
      viewportHeight: 2_000,
    }));

    await expect(
      (handler as any)(makeEvent(makeFormData({ screenshots }))),
    ).rejects.toMatchObject({
      statusCode: 413,
      statusMessage: "Screenshot batch exceeds the decoded pixel limit",
    });
    expect(mocks.assertAccess).not.toHaveBeenCalled();
    expect(mocks.mintAttachmentRef).not.toHaveBeenCalled();
  });

  it("does not create a partial board when private screenshot storage is unavailable", async () => {
    mocks.mintAttachmentRef.mockResolvedValue({ status: "storageUnavailable" });

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: "Design private screenshot storage is unavailable",
    });
    expect(mocks.runAction).not.toHaveBeenCalled();
    const designReads = mocks.whereCalls.filter(
      (query) => query.table === mocks.designsTable,
    );
    const expectedDesignScope = {
      type: "and",
      conditions: [
        { type: "eq", column: mocks.designsTable.id, value: designId },
        {
          type: "eq",
          column: mocks.designsTable.ownerEmail,
          value: "ada@example.test",
        },
        { type: "isNull", column: mocks.designsTable.orgId },
        {
          type: "eq",
          column: mocks.designsTable.visibility,
          value: "private",
        },
      ],
    };
    expect(designReads.length).toBeGreaterThanOrEqual(2);
    for (const query of designReads) {
      expect(query.conditions[0]).toEqual(expectedDesignScope);
    }
    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      {
        id: designId,
        expectedCreatedShell: expect.objectContaining({
          title: "Session replay storyboard",
          data: "{}",
          updatedAt: "2026-10-11T12:00:00.000Z",
          ownerEmail: "ada@example.test",
          orgId: null,
          visibility: "private",
        }),
      },
      expect.objectContaining({
        actionName: "delete-design",
        userEmail: "ada@example.test",
        orgId: null,
      }),
    );
  });

  it("reports cleanup state when deleting a new board is not confirmed", async () => {
    mocks.mintAttachmentRef.mockResolvedValue({ status: "storageUnavailable" });
    mocks.deleteDesign.mockResolvedValue({ id: designId, deleted: false });

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({
      statusCode: 503,
      data: { cleanupPending: true },
    });
  });

  it("deletes only the newly created board after a known save failure", async () => {
    mocks.runAction.mockRejectedValueOnce(
      Object.assign(new Error("The storyboard was not saved"), {
        actionContractError: true,
        errorCode: "storyboard_conflict",
        statusCode: 409,
        details: { saveOutcomeUnknown: false },
      }),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.deleteDesign).toHaveBeenCalledWith(
      {
        id: designId,
        expectedCreatedShell: expect.objectContaining({
          updatedAt: "2026-10-11T12:00:00.000Z",
        }),
      },
      expect.objectContaining({ actionName: "delete-design" }),
    );
  });

  it("preserves a newly created board when the save outcome is unknown", async () => {
    mocks.runAction.mockRejectedValueOnce(
      Object.assign(new Error("The storyboard save could not be confirmed"), {
        actionContractError: true,
        errorCode: "action_failed",
        statusCode: 502,
        details: { saveOutcomeUnknown: true },
      }),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData({ designId: null }))),
    ).rejects.toMatchObject({
      statusCode: 502,
      data: { saveOutcomeUnknown: true },
    });
    expect(mocks.deleteDesign).not.toHaveBeenCalled();
  });

  it("never deletes an existing board after a known save failure", async () => {
    mocks.runAction.mockRejectedValueOnce(
      Object.assign(new Error("The storyboard was not saved"), {
        actionContractError: true,
        errorCode: "storyboard_conflict",
        statusCode: 409,
        details: {},
      }),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.deleteDesign).not.toHaveBeenCalled();
  });

  it("reports when a temporary attachment cannot be cleaned up", async () => {
    mocks.deleteAttachment.mockResolvedValue({ status: "ok", deleted: false });

    const result = await (handler as any)(makeEvent(makeFormData()));

    expect(result.cleanupPending).toBe(true);
  });

  it("preserves the action error and reports cleanup that could not be completed", async () => {
    mocks.runAction.mockRejectedValueOnce(
      Object.assign(new Error("The storyboard action failed"), {
        statusCode: 409,
        statusMessage: "The storyboard action failed",
        data: { action: "add-session-replay-screenshots-to-board" },
      }),
    );
    mocks.deleteAttachment.mockRejectedValueOnce(
      new Error("temporary blob deletion failed"),
    );

    await expect(
      (handler as any)(makeEvent(makeFormData())),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: "The storyboard action failed",
      data: {
        action: "add-session-replay-screenshots-to-board",
        cleanupPending: true,
      },
    });
    expect(mocks.deleteAttachment).toHaveBeenCalledWith(
      "private-attachment-ref",
      { ownerEmail: "ada@example.test", orgId: null },
    );
  });

  it.each([false, true])(
    "normalizes action contract errors when cleanupPending is %s",
    async (cleanupPending) => {
      const contractError = Object.assign(
        new Error("The storyboard action was rejected"),
        {
          actionContractError: true,
          errorCode: "storyboard_conflict",
          details: { designId },
          statusCode: 409,
        },
      );
      mocks.runAction.mockRejectedValueOnce(contractError);
      if (cleanupPending) {
        mocks.deleteAttachment.mockResolvedValueOnce({
          status: "ok",
          deleted: false,
        });
      }

      const thrown = await (handler as any)(makeEvent(makeFormData())).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(thrown).toMatchObject({
        statusCode: 409,
        statusMessage: "The storyboard action was rejected",
        data: {
          error: "The storyboard action was rejected",
          errorCode: "storyboard_conflict",
          details: { designId },
          ...(cleanupPending ? { cleanupPending: true } : {}),
        },
      });
      const cause = (thrown as { cause?: unknown }).cause as
        | { cause?: unknown }
        | undefined;
      expect(cause?.cause).toBe(contractError);
    },
  );

  it("forwards action rollback and cleanup state in the upload error data", async () => {
    mocks.runAction.mockRejectedValueOnce(
      Object.assign(new Error("The storyboard rollback is uncertain"), {
        actionContractError: true,
        errorCode: "action_failed",
        statusCode: 502,
        details: {
          cleanupPending: true,
          cleanupFailed: true,
          cleanupUnknown: true,
          saveOutcomeUnknown: true,
        },
      }),
    );

    const thrown = await (handler as any)(makeEvent(makeFormData())).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toMatchObject({
      statusCode: 502,
      statusMessage: "The storyboard rollback is uncertain",
      data: {
        cleanupPending: true,
        cleanupFailed: true,
        cleanupUnknown: true,
        saveOutcomeUnknown: true,
        details: {
          cleanupPending: true,
          cleanupFailed: true,
          cleanupUnknown: true,
          saveOutcomeUnknown: true,
        },
      },
    });
  });
});

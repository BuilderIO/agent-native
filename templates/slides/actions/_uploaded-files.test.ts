import { isAgentActionStopError } from "@agent-native/core/action";
import {
  ATTACHMENT_REF_PREFIX,
  PrivateBlobError,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const hosted = vi.hoisted(() => ({ value: true }));

vi.mock("fs", () => ({
  default: {
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    promises: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
    },
  },
}));

vi.mock("../server/lib/tenant-files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/tenant-files.js")>()),
  tenantUploadDir: () => "/uploads/owner",
  isHostedSlidesRuntime: () => hosted.value,
}));

import { mintUploadedReference } from "../server/lib/uploaded-reference-storage";
import { readUserUploadedFile } from "./_uploaded-files";

const OWNER = "owner@example.com";
const originalKey = process.env.SECRETS_ENCRYPTION_KEY;

const blobs = new Map<string, Uint8Array>();
let readError: unknown = null;
const provider: PrivateBlobProvider = {
  id: "memory",
  name: "Memory",
  isConfigured: () => true,
  put: async (input) => {
    const id = `memory:${blobs.size + 1}`;
    blobs.set(id, new Uint8Array(input.data));
    return { id, provider: "memory", opaque: true, encrypted: false };
  },
  read: async (handle: PrivateBlobHandle) => {
    if (readError) throw readError;
    const data = blobs.get(handle.id);
    if (!data) throw new PrivateBlobError("missing", "not_found");
    return { data, handle };
  },
  delete: async (handle: PrivateBlobHandle) => ({
    deleted: blobs.delete(handle.id),
    provider: "memory",
  }),
};

const inOrg = async <T>(
  orgId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> => runWithRequestContext({ userEmail: OWNER, orgId }, fn);

async function mint(filename = "deck.pptx", data = Buffer.from("pptx")) {
  const minted = await mintUploadedReference({
    email: OWNER,
    orgId: "org-one",
    filename,
    data,
    mimeType: "application/octet-stream",
  });
  if (minted.status !== "ok") throw new Error("mint failed");
  return minted.ref;
}

const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("readUserUploadedFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hosted.value = true;
    readError = null;
    blobs.clear();
    process.env.SECRETS_ENCRYPTION_KEY = "slides-uploaded-files-test";
    registerPrivateBlobProvider(provider);
  });

  afterEach(() => {
    unregisterPrivateBlobProvider("memory");
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
  });

  it("returns durable hosted upload bytes without touching local files", async () => {
    const ref = await mint();
    expect(ref.startsWith(ATTACHMENT_REF_PREFIX)).toBe(true);

    await expect(
      inOrg("org-one", () => readUserUploadedFile(ref)),
    ).resolves.toEqual({ data: Buffer.from("pptx"), filename: "deck.pptx" });
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("resolves the file name or URL the model used to the reference stamped on the attachment", async () => {
    const ref = await mint("report.pdf");
    const attachments = [
      { type: "file", name: "report.pdf", slidesUploadPath: ref },
      {
        type: "file",
        name: "other.pdf",
        url: "https://cdn.example.test/other.pdf",
        slidesUploadPath: "attachment:v1:unrelated",
      },
    ];

    await expect(
      inOrg("org-one", () =>
        readUserUploadedFile("report.pdf", { attachments }),
      ),
    ).resolves.toMatchObject({ filename: "report.pdf" });
    await expect(
      inOrg("org-one", () => readUserUploadedFile("report.pdf")),
    ).rejects.toMatchObject({
      details: { attachmentStatus: "malformed", reason: "unrecognized_scheme" },
    });
  });

  it("reads an authenticated user's local upload outside hosted runtimes", async () => {
    hosted.value = false;
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("local"));

    await expect(
      inOrg(undefined, () => readUserUploadedFile("/uploads/owner/deck.pptx")),
    ).resolves.toEqual({ data: Buffer.from("local"), filename: "deck.pptx" });
  });

  it("resolves a file name to the stamped local upload outside hosted runtimes", async () => {
    hosted.value = false;
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(Buffer.from("local"));
    const attachments = [
      {
        type: "file",
        name: "deck.pptx",
        slidesUploadPath: "/uploads/owner/1700000000-deck.pptx",
      },
    ];

    await expect(
      inOrg(undefined, () =>
        readUserUploadedFile("deck.pptx", { attachments }),
      ),
    ).resolves.toEqual({
      data: Buffer.from("local"),
      filename: "1700000000-deck.pptx",
    });
    expect(mockReadFile).toHaveBeenCalledWith(
      "/uploads/owner/1700000000-deck.pptx",
    );
  });

  it("stops with a typed forbidden result for a local path outside the user's uploads", async () => {
    hosted.value = false;
    const error = await caught(
      inOrg(undefined, () => readUserUploadedFile("/uploads/other/deck.pptx")),
    );

    expect(isAgentActionStopError(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: "permanent_precondition",
      statusCode: 403,
      details: {
        attachmentErrorCode: "attachment_forbidden_scope",
        reason: "path_outside_uploads",
      },
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("stops with a typed not-found result for a missing local file", async () => {
    hosted.value = false;
    mockExistsSync.mockReturnValue(false);

    await expect(
      inOrg(undefined, () => readUserUploadedFile("/uploads/owner/gone.pptx")),
    ).rejects.toMatchObject({
      statusCode: 404,
      details: { attachmentErrorCode: "attachment_not_found" },
    });
  });

  it("does not fall back to the local filesystem for a non-reference on hosted runtimes", async () => {
    const error = await caught(
      inOrg(undefined, () => readUserUploadedFile("/var/task/data/deck.pdf")),
    );

    expect(error).toMatchObject({
      statusCode: 400,
      details: {
        attachmentErrorCode: "attachment_malformed",
        reason: "unrecognized_scheme",
      },
    });
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it("maps each cause to its own typed result and only an outage keeps the run alive", async () => {
    const ref = await mint();

    const orgDrift = await caught(
      inOrg("org-two", () => readUserUploadedFile(ref)),
    );
    expect(orgDrift).toMatchObject({
      errorCode: "permanent_precondition",
      statusCode: 403,
      details: { attachmentErrorCode: "attachment_forbidden_scope" },
    });
    expect((orgDrift as Error).message).toMatch(/different workspace/);

    const cutShort = await caught(
      inOrg("org-one", () => readUserUploadedFile(ref.slice(0, -30))),
    );
    expect(cutShort).toMatchObject({
      statusCode: 410,
      details: { attachmentErrorCode: "attachment_expired" },
    });
    expect((cutShort as Error).message).toMatch(/cut short or altered/);

    blobs.clear();
    const missing = await caught(
      inOrg("org-one", () => readUserUploadedFile(ref)),
    );
    expect(missing).toMatchObject({
      statusCode: 404,
      details: { attachmentErrorCode: "attachment_not_found" },
    });

    readError = new Error("socket hang up");
    const outage = await caught(
      inOrg("org-one", () => readUserUploadedFile(ref)),
    );
    expect(isAgentActionStopError(outage)).toBe(false);
    expect(outage).toMatchObject({
      errorCode: "attachment_storage_unavailable",
      statusCode: 503,
      details: { retryable: true, whoCanFix: "self_resolving" },
    });
  });
});

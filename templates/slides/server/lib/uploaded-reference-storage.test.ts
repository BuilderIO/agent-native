import {
  ATTACHMENT_REF_PREFIX,
  LEGACY_SLIDES_UPLOAD_REF_PREFIX,
  PrivateBlobError,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { encryptSecretValue } from "@agent-native/core/secrets/crypto";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { tenantFileKey } from "./tenant-files";
import {
  deleteUploadedReference,
  isHostedSlidesRuntime,
  mintUploadedReference,
  resolveUploadedReference,
} from "./uploaded-reference-storage";

const OWNER = "owner@example.com";
const originalKey = process.env.SECRETS_ENCRYPTION_KEY;
const originalNetlify = process.env.NETLIFY;

const blobs = new Map<string, Uint8Array>();
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

describe("Slides uploaded reference storage", () => {
  beforeEach(() => {
    blobs.clear();
    process.env.SECRETS_ENCRYPTION_KEY = "slides-reference-storage-test";
    process.env.NETLIFY = "true";
    registerPrivateBlobProvider(provider);
  });

  afterEach(() => {
    unregisterPrivateBlobProvider("memory");
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
    if (originalNetlify === undefined) delete process.env.NETLIFY;
    else process.env.NETLIFY = originalNetlify;
  });

  it("recognizes hosted runtimes without treating local development as hosted", () => {
    expect(isHostedSlidesRuntime("/workspace/slides", {})).toBe(false);
    expect(isHostedSlidesRuntime("/var/task", {})).toBe(true);
    expect(
      isHostedSlidesRuntime("/workspace/slides", { NETLIFY: "true" }),
    ).toBe(true);
    expect(
      isHostedSlidesRuntime("/workspace/slides", {
        NETLIFY: "true",
        NETLIFY_LOCAL: "true",
      }),
    ).toBe(false);
    expect(
      isHostedSlidesRuntime("/workspace/slides", { NETLIFY: "false" }),
    ).toBe(false);
    expect(isHostedSlidesRuntime("/workspace/slides", { RENDER: "true" })).toBe(
      true,
    );
    expect(
      isHostedSlidesRuntime("/workspace/slides", { K_SERVICE: "slides" }),
    ).toBe(true);
  });

  it("mints a core attachment ref bound to the active org and opens it in that org", async () => {
    const minted = await inOrg("existing-org", () =>
      mintUploadedReference({
        email: OWNER,
        filename: "deck.pptx",
        data: new Uint8Array([1, 2, 3]),
        mimeType: "application/octet-stream",
      }),
    );
    if (minted.status !== "ok") throw new Error("mint failed");

    expect(minted.ref.startsWith(ATTACHMENT_REF_PREFIX)).toBe(true);
    await expect(
      inOrg("existing-org", () => resolveUploadedReference(minted.ref, OWNER)),
    ).resolves.toMatchObject({
      status: "ok",
      file: { data: Buffer.from([1, 2, 3]), filename: "deck.pptx" },
    });
  });

  it("uses an explicitly supplied org over the request's", async () => {
    const minted = await inOrg("request-org", () =>
      mintUploadedReference({
        email: OWNER,
        orgId: "session-org",
        filename: "deck.pptx",
        data: new Uint8Array([1]),
        mimeType: "application/octet-stream",
      }),
    );
    if (minted.status !== "ok") throw new Error("mint failed");

    await expect(
      inOrg("session-org", () => resolveUploadedReference(minted.ref, OWNER)),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      inOrg("request-org", () => resolveUploadedReference(minted.ref, OWNER)),
    ).resolves.toMatchObject({
      status: "forbiddenScope",
      reason: "org_mismatch",
    });
  });

  it("keeps personal uploads outside organization scopes", async () => {
    const minted = await inOrg(undefined, () =>
      mintUploadedReference({
        email: OWNER,
        orgId: null,
        filename: "deck.pptx",
        data: new Uint8Array([1]),
        mimeType: "application/octet-stream",
      }),
    );
    if (minted.status !== "ok") throw new Error("mint failed");

    await expect(
      inOrg(undefined, () => resolveUploadedReference(minted.ref, OWNER)),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      inOrg("org-one", () => resolveUploadedReference(minted.ref, OWNER)),
    ).resolves.toMatchObject({
      status: "forbiddenScope",
      reason: "org_mismatch",
    });
  });

  it("rejects another user's reference before reading storage", async () => {
    const minted = await inOrg("org-one", () =>
      mintUploadedReference({
        email: OWNER,
        orgId: "org-one",
        filename: "deck.pptx",
        data: new Uint8Array([1]),
        mimeType: "application/octet-stream",
      }),
    );
    if (minted.status !== "ok") throw new Error("mint failed");

    await expect(
      inOrg("org-one", () =>
        resolveUploadedReference(minted.ref, "other@example.com"),
      ),
    ).resolves.toMatchObject({
      status: "forbiddenScope",
      reason: "owner_mismatch",
    });
  });

  it("still opens refs minted with the Slides-only descriptor", async () => {
    // Same ownerKey derivation, same payload: the core resolver must open what
    // Slides stored in chat threads and decks before the ref moved to core.
    const handle = await provider.put({ data: Buffer.from("legacy") });
    const legacy = `${LEGACY_SLIDES_UPLOAD_REF_PREFIX}${encryptSecretValue(
      JSON.stringify({
        kind: "slides-upload",
        version: 1,
        ownerKey: tenantFileKey(OWNER),
        orgId: "org-one",
        filename: "deck.pdf",
        handle,
      }),
    )}`;

    await expect(
      inOrg("org-one", () => resolveUploadedReference(legacy, OWNER)),
    ).resolves.toMatchObject({
      status: "ok",
      file: { data: Buffer.from("legacy"), filename: "deck.pdf" },
    });
  });

  it("deletes through the same scope checks and types a foreign delete", async () => {
    const minted = await inOrg("org-one", () =>
      mintUploadedReference({
        email: OWNER,
        orgId: "org-one",
        filename: "deck.pptx",
        data: new Uint8Array([1]),
        mimeType: "application/octet-stream",
      }),
    );
    if (minted.status !== "ok") throw new Error("mint failed");

    await expect(
      inOrg("org-two", () => deleteUploadedReference(minted.ref, OWNER)),
    ).rejects.toMatchObject({
      statusCode: 403,
      details: { attachmentErrorCode: "attachment_forbidden_scope" },
    });
    expect(blobs.size).toBe(1);
    await expect(
      inOrg("org-one", () => deleteUploadedReference(minted.ref, OWNER)),
    ).resolves.toBe(true);
    expect(blobs.size).toBe(0);
  });
});

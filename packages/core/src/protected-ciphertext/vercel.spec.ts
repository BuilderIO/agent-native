import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  del: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => blob);

const originalEnv = { ...process.env };
const coordinate = {
  kind: "object",
  vaultId: "vault:test-0001",
  objectId: "object:test-0001",
  revisionId: "revision:test-0001",
  part: "header",
} as const;
const recoveryWrapCoordinate = {
  kind: "recovery-wrap",
  vaultId: "vault:test-0001",
  recoveryWrapHash: "a".repeat(64),
} as const;

async function subject() {
  vi.resetModules();
  return import("./vercel.js");
}

function configureToken() {
  process.env.BLOB_READ_WRITE_TOKEN = "test-protected-blob-token";
  process.env.AGENT_NATIVE_PROTECTED_CIPHERTEXT_STORAGE_GENERATION =
    "store:test-protected-v1";
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.BLOB_STORE_ID;
}

function byteStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("Vercel protected ciphertext provider", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const mock of Object.values(blob)) mock.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("requires an explicit immutable storage generation in addition to credentials", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test-protected-blob-token";
    delete process.env.AGENT_NATIVE_PROTECTED_CIPHERTEXT_STORAGE_GENERATION;
    const { vercelProtectedCiphertextProvider } = await subject();
    expect(vercelProtectedCiphertextProvider.isConfigured()).toBe(false);

    process.env.AGENT_NATIVE_PROTECTED_CIPHERTEXT_STORAGE_GENERATION =
      "store:test-protected-v1";
    expect(vercelProtectedCiphertextProvider.isConfigured()).toBe(true);
    expect(vercelProtectedCiphertextProvider.storageGeneration?.()).toBe(
      "store:test-protected-v1",
    );
  });

  it("bounds actual provider streams before buffering them", async () => {
    const { _vercelProtectedCiphertextForTests } = await subject();
    await expect(
      _vercelProtectedCiphertextForTests.streamToBytes(
        byteStream(new Uint8Array([1, 2, 3, 4])),
        3,
      ),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextLengthMismatchError",
    });
  });

  it("derives a deterministic protected pathname and performs immutable private writes", async () => {
    configureToken();
    blob.put.mockResolvedValue({ pathname: "ignored" });
    const {
      vercelProtectedCiphertextProvider,
      _vercelProtectedCiphertextForTests,
    } = await subject();
    const ciphertext = new Uint8Array([1, 2, 3]);

    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate,
        ciphertext,
        expectedByteLength: ciphertext.byteLength,
      }),
    ).resolves.toMatchObject({ created: true, byteLength: 3 });

    const expectedPath =
      "agent-native/protected-ciphertext/v1/vault:test-0001/objects/object:test-0001/revision:test-0001/header.bin";
    expect(_vercelProtectedCiphertextForTests.coordinatePath(coordinate)).toBe(
      expectedPath,
    );
    expect(blob.put).toHaveBeenCalledWith(
      expectedPath,
      expect.any(Buffer),
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "application/octet-stream",
        multipart: false,
        token: "test-protected-blob-token",
      }),
    );

    expect(
      _vercelProtectedCiphertextForTests.coordinatePath({
        ...coordinate,
        part: "chunk",
        chunkIndex: 42,
      }),
    ).toMatch(/\/chunks\/000042\.bin$/);
    expect(
      _vercelProtectedCiphertextForTests.coordinatePath({
        kind: "job",
        vaultId: coordinate.vaultId,
        jobId: "job:test-0001",
        part: "request",
      }),
    ).toContain("/jobs/job:test-0001/request.bin");
    expect(
      _vercelProtectedCiphertextForTests.coordinatePath({
        kind: "key-envelope",
        vaultId: coordinate.vaultId,
        envelopeId: "envelope:test-0001",
      }),
    ).toContain("/key-envelopes/envelope:test-0001.bin");
    expect(
      _vercelProtectedCiphertextForTests.coordinatePath(recoveryWrapCoordinate),
    ).toBe(
      `agent-native/protected-ciphertext/v1/vault:test-0001/recovery-wraps/${"a".repeat(64)}.bin`,
    );
    expect(
      _vercelProtectedCiphertextForTests.coordinatePath({
        kind: "grant",
        vaultId: coordinate.vaultId,
        grantId: "grant:test-0001",
      }),
    ).toContain("/grants/grant:test-0001.bin");
  });

  it("rejects malformed object parts and direct provider length mismatches", async () => {
    configureToken();
    const {
      vercelProtectedCiphertextProvider,
      _vercelProtectedCiphertextForTests,
    } = await subject();
    expect(() =>
      _vercelProtectedCiphertextForTests.coordinatePath({
        ...coordinate,
        part: "chunk",
      }),
    ).toThrow("chunk index");
    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate,
        ciphertext: new Uint8Array([1, 2]),
        expectedByteLength: 1,
      }),
    ).rejects.toMatchObject({ name: "ProtectedCiphertextLengthMismatchError" });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("rejects malformed recovery-wrap paths and over-limit direct writes", async () => {
    configureToken();
    const {
      vercelProtectedCiphertextProvider,
      _vercelProtectedCiphertextForTests,
    } = await subject();
    for (const recoveryWrapHash of [
      "A".repeat(64),
      "a".repeat(63),
      `${"a".repeat(63)}g`,
      `../${"a".repeat(61)}`,
    ]) {
      expect(() =>
        _vercelProtectedCiphertextForTests.coordinatePath({
          ...recoveryWrapCoordinate,
          recoveryWrapHash,
        }),
      ).toThrow();
    }
    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate: recoveryWrapCoordinate,
        ciphertext: new Uint8Array(1024 * 1024 + 1),
        expectedByteLength: 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ name: "ProtectedCiphertextLengthMismatchError" });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("recovers an equal-byte immutable retry and rejects a different-byte collision", async () => {
    configureToken();
    const putFailure = new Error("pathname already exists");
    blob.put.mockRejectedValue(putFailure);
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: byteStream(new Uint8Array([4, 5, 6])),
      blob: { contentType: "application/octet-stream" },
    });
    const { vercelProtectedCiphertextProvider } = await subject();

    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate,
        ciphertext: new Uint8Array([4, 5, 6]),
        expectedByteLength: 3,
      }),
    ).resolves.toMatchObject({ created: false, byteLength: 3 });
    expect(blob.get).toHaveBeenCalledWith(
      expect.stringContaining("/header.bin"),
      expect.objectContaining({
        access: "private",
        useCache: false,
        token: "test-protected-blob-token",
      }),
    );

    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: byteStream(new Uint8Array([9, 9, 9])),
      blob: { contentType: "application/octet-stream" },
    });
    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate,
        ciphertext: new Uint8Array([4, 5, 6]),
        expectedByteLength: 3,
      }),
    ).rejects.toMatchObject({ name: "ProtectedCiphertextCollisionError" });
  });

  it("rethrows a provider write failure when no committed object exists", async () => {
    configureToken();
    const putFailure = new Error("provider unavailable");
    blob.put.mockRejectedValue(putFailure);
    blob.get.mockResolvedValue(null);
    const { vercelProtectedCiphertextProvider } = await subject();
    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate,
        ciphertext: new Uint8Array([1]),
        expectedByteLength: 1,
      }),
    ).rejects.toBe(putFailure);
  });

  it("bounds recovery-wrap streams on immutable collision recovery and reads", async () => {
    configureToken();
    const overLimit = new Uint8Array(1024 * 1024 + 1);
    blob.put.mockRejectedValue(new Error("pathname already exists"));
    blob.get.mockImplementation(async () => ({
      statusCode: 200,
      stream: byteStream(overLimit),
      blob: { contentType: "application/octet-stream" },
    }));
    const { vercelProtectedCiphertextProvider } = await subject();

    await expect(
      vercelProtectedCiphertextProvider.put({
        coordinate: recoveryWrapCoordinate,
        ciphertext: new Uint8Array([1]),
        expectedByteLength: 1,
      }),
    ).rejects.toMatchObject({ name: "ProtectedCiphertextLengthMismatchError" });

    const locator = {
      kind: "agent-native.protected-ciphertext" as const,
      version: 1 as const,
      provider: vercelProtectedCiphertextProvider.id,
      opaque: true as const,
      coordinate: recoveryWrapCoordinate,
    };
    await expect(
      vercelProtectedCiphertextProvider.read(locator),
    ).rejects.toMatchObject({ name: "ProtectedCiphertextLengthMismatchError" });
  });

  it("reads without cache, reports not-found, and deletes exact coordinates", async () => {
    configureToken();
    const { vercelProtectedCiphertextProvider } = await subject();
    const locator = {
      kind: "agent-native.protected-ciphertext" as const,
      version: 1 as const,
      provider: vercelProtectedCiphertextProvider.id,
      opaque: true as const,
      coordinate,
    };
    blob.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: byteStream(new Uint8Array([7, 8])),
      blob: { contentType: "application/octet-stream" },
    });
    await expect(
      vercelProtectedCiphertextProvider.read(locator),
    ).resolves.toMatchObject({
      ciphertext: new Uint8Array([7, 8]),
      byteLength: 2,
    });
    expect(blob.get).toHaveBeenLastCalledWith(
      expect.stringContaining("agent-native/protected-ciphertext/v1/"),
      expect.objectContaining({ access: "private", useCache: false }),
    );

    blob.get.mockResolvedValueOnce(null);
    await expect(
      vercelProtectedCiphertextProvider.read(locator),
    ).rejects.toMatchObject({
      name: "ProtectedCiphertextNotFoundError",
    });

    blob.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: byteStream(new Uint8Array([7, 8])),
      blob: { contentType: "application/octet-stream" },
    });
    blob.del.mockResolvedValue(undefined);
    await expect(
      vercelProtectedCiphertextProvider.delete(locator),
    ).resolves.toEqual({
      deleted: true,
      provider: vercelProtectedCiphertextProvider.id,
    });
    expect(blob.del).toHaveBeenCalledWith(
      expect.stringContaining("/header.bin"),
      { token: "test-protected-blob-token" },
    );
  });

  it("lists validated prefixes to exhaustion and deletes only returned protected paths", async () => {
    configureToken();
    blob.list
      .mockResolvedValueOnce({
        blobs: [
          {
            pathname:
              "agent-native/protected-ciphertext/v1/vault:test-0001/objects/object:test-0001/revision:a/header.bin",
          },
        ],
        hasMore: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        blobs: [
          {
            pathname:
              "agent-native/protected-ciphertext/v1/vault:test-0001/objects/object:test-0001/revision:b/header.bin",
          },
        ],
        hasMore: false,
      });
    blob.del.mockResolvedValue(undefined);
    const { vercelProtectedCiphertextProvider } = await subject();

    await expect(
      vercelProtectedCiphertextProvider.deletePrefix!({
        scope: "object",
        vaultId: coordinate.vaultId,
        objectId: coordinate.objectId,
      }),
    ).resolves.toEqual({
      deleted: 2,
      provider: vercelProtectedCiphertextProvider.id,
    });
    expect(blob.list).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        prefix:
          "agent-native/protected-ciphertext/v1/vault:test-0001/objects/object:test-0001/",
        limit: 1000,
      }),
    );
    expect(blob.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "next-page" }),
    );
    expect(blob.del).toHaveBeenCalledWith(
      [
        "agent-native/protected-ciphertext/v1/vault:test-0001/objects/object:test-0001/revision:a/header.bin",
        "agent-native/protected-ciphertext/v1/vault:test-0001/objects/object:test-0001/revision:b/header.bin",
      ],
      { token: "test-protected-blob-token" },
    );
  });

  it("includes recovery wraps in whole-vault prefix deletion", async () => {
    configureToken();
    const recoveryWrapPath = `agent-native/protected-ciphertext/v1/vault:test-0001/recovery-wraps/${"a".repeat(64)}.bin`;
    blob.list.mockResolvedValue({
      blobs: [{ pathname: recoveryWrapPath }],
      hasMore: false,
    });
    blob.del.mockResolvedValue(undefined);
    const { vercelProtectedCiphertextProvider } = await subject();

    await expect(
      vercelProtectedCiphertextProvider.deletePrefix!({
        scope: "vault",
        vaultId: coordinate.vaultId,
      }),
    ).resolves.toEqual({
      deleted: 1,
      provider: vercelProtectedCiphertextProvider.id,
    });
    expect(blob.list).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: "agent-native/protected-ciphertext/v1/vault:test-0001/",
      }),
    );
    expect(blob.del).toHaveBeenCalledWith([recoveryWrapPath], {
      token: "test-protected-blob-token",
    });
  });
});

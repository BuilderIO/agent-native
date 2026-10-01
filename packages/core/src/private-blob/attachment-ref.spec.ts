import { createHash, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isActionContractError, isAgentActionStopError } from "../action.js";
import { resetAppConfigForTests } from "../app-config/index.js";
import { encryptSecretValue } from "../secrets/crypto.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  ATTACHMENT_ERROR_CODES,
  ATTACHMENT_REF_MAX_CHARS,
  ATTACHMENT_REF_PREFIX,
  LEGACY_SLIDES_UPLOAD_REF_PREFIX,
  PrivateBlobError,
  attachmentFailureToError,
  attachmentOwnerKey,
  deleteAttachment,
  describeAttachmentFailure,
  isAttachmentError,
  isAttachmentRef,
  isRetryableAttachmentFailure,
  mintAttachmentRef,
  registerPrivateBlobProvider,
  resolveAttachment,
  setPrivateBlobPublicUploadFallbackEnabled,
  unregisterPrivateBlobProvider,
  unwrapAttachment,
  type AttachmentFailure,
  type PrivateBlobHandle,
  type PrivateBlobProvider,
} from "./index.js";

const countOutcomeMock = vi.hoisted(() => vi.fn());
vi.mock("../tracking/failure-counters.js", () => ({
  countAttachmentOutcome: countOutcomeMock,
}));

const uploadFileMock = vi.hoisted(() => vi.fn());
const getActiveFileUploadProviderForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("../file-upload/index.js", () => ({
  deleteUploadedFile: vi.fn(),
  getActiveFileUploadProviderForRequest:
    getActiveFileUploadProviderForRequestMock,
  uploadFile: uploadFileMock,
}));

const OWNER = "owner@example.com";
const originalEnv = { ...process.env };

class MemoryProvider implements PrivateBlobProvider {
  id = "memory";
  name = "Memory";
  blobs = new Map<string, { data: Uint8Array; mimeType?: string }>();
  readError: unknown = null;
  isConfigured = () => true;
  put = async (input: {
    data: Uint8Array | Buffer;
    mimeType?: string;
  }): Promise<PrivateBlobHandle> => {
    const id = `memory:${this.blobs.size + 1}`;
    this.blobs.set(id, {
      data: new Uint8Array(input.data),
      mimeType: input.mimeType,
    });
    return {
      id,
      provider: this.id,
      opaque: true,
      encrypted: false,
      mimeType: input.mimeType,
    };
  };
  read = async (handle: PrivateBlobHandle) => {
    if (this.readError) throw this.readError;
    const blob = this.blobs.get(handle.id);
    if (!blob) throw new PrivateBlobError("missing", "not_found");
    return { data: blob.data, mimeType: blob.mimeType, handle };
  };
  delete = async (handle: PrivateBlobHandle) => ({
    deleted: this.blobs.delete(handle.id),
    provider: this.id,
  });
}

let provider: MemoryProvider;

beforeEach(() => {
  process.env = { ...originalEnv, SECRETS_ENCRYPTION_KEY: "attachment-key-a" };
  resetAppConfigForTests();
  provider = new MemoryProvider();
  registerPrivateBlobProvider(provider);
  setPrivateBlobPublicUploadFallbackEnabled(true);
  uploadFileMock.mockReset();
  getActiveFileUploadProviderForRequestMock.mockReset();
  getActiveFileUploadProviderForRequestMock.mockResolvedValue(null);
});

afterEach(() => {
  unregisterPrivateBlobProvider("memory");
  setPrivateBlobPublicUploadFallbackEnabled(true);
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

const inOrg = <T>(orgId: string | undefined, fn: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER, orgId }, fn);

async function mint(
  overrides: Partial<Parameters<typeof mintAttachmentRef>[0]> = {},
) {
  const minted = await mintAttachmentRef({
    data: new Uint8Array([1, 2, 3]),
    filename: "report.pdf",
    mimeType: "application/pdf",
    ownerEmail: OWNER,
    orgId: "org-one",
    ...overrides,
  });
  if (minted.status !== "ok") throw new Error(`mint failed: ${minted.reason}`);
  return minted.ref;
}

const COMPOSER_KINDS = [
  {
    kind: "pdf",
    filename: "Quarterly report.pdf",
    mimeType: "application/pdf",
    data: Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(2048)]),
  },
  {
    kind: "image",
    filename: "logo.png",
    mimeType: "image/png",
    data: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(4096),
    ]),
  },
  {
    kind: "text/markdown",
    filename: "brief.md",
    mimeType: "text/markdown",
    data: Buffer.from("# Brief\n\nShip the deck.\n", "utf8"),
  },
  {
    kind: "large file",
    filename: "huge-deck.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    data: randomBytes(6 * 1024 * 1024),
  },
] as const;

describe("one minted attachment ref", () => {
  it.each(COMPOSER_KINDS)(
    "round-trips a $kind through the one resolver",
    async ({ filename, mimeType, data }) => {
      const ref = await mint({ filename, mimeType, data });

      expect(isAttachmentRef(ref)).toBe(true);
      expect(ref.startsWith(ATTACHMENT_REF_PREFIX)).toBe(true);
      const resolved = await resolveAttachment(ref, {
        ownerEmail: OWNER,
        orgId: "org-one",
      });
      expect(resolved.status).toBe("ok");
      const file = unwrapAttachment(resolved);
      expect(file.filename).toBe(filename);
      expect(file.mimeType).toBe(mimeType);
      expect(file.size).toBe(data.byteLength);
      expect(Buffer.compare(file.data, data)).toBe(0);
    },
  );

  it("scopes the ref to the active request org when none is passed", async () => {
    const ref = await inOrg("org-from-request", () =>
      mint({ orgId: undefined }),
    );

    await expect(
      inOrg("org-from-request", () =>
        resolveAttachment(ref, { ownerEmail: OWNER }),
      ),
    ).resolves.toMatchObject({ status: "ok" });
    await expect(
      inOrg("another-org", () => resolveAttachment(ref, { ownerEmail: OWNER })),
    ).resolves.toMatchObject({
      status: "forbiddenScope",
      reason: "org_mismatch",
    });
  });

  it("keeps a ref minted through the public-upload fallback short enough to survive a 2,000-character cap", async () => {
    unregisterPrivateBlobProvider("memory");
    getActiveFileUploadProviderForRequestMock.mockResolvedValue({
      id: "builder",
    });
    let uploaded: { data: Uint8Array } | undefined;
    uploadFileMock.mockImplementation(async (input: { data: Uint8Array }) => {
      uploaded = input;
      return {
        url: "https://cdn.builder.io/api/v1/file/assets%2F0123456789abcdef0123456789abcdef%2Fabcdef0123456789abcdef0123456789abcdef",
        provider: "builder",
        id: "asset-1",
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(uploaded?.data ?? new Uint8Array())),
    );

    const ref = await mint({
      filename: "Quarterly report final v3.pdf",
      orgId: "org_0123456789abcdef",
      metadata: { kind: "slides-reference-upload" },
    });

    expect(ref.length).toBeLessThan(2000);
    expect(ref.length).toBeLessThan(ATTACHMENT_REF_MAX_CHARS);
    await expect(
      resolveAttachment(ref, {
        ownerEmail: OWNER,
        orgId: "org_0123456789abcdef",
      }),
    ).resolves.toMatchObject({ status: "ok" });
  });

  it("opens refs minted by Slides before the ref moved to core", async () => {
    const handle = await provider.put({
      data: Buffer.from("legacy pptx"),
      mimeType: "application/pdf",
    });
    const legacy = `${LEGACY_SLIDES_UPLOAD_REF_PREFIX}${encryptSecretValue(
      JSON.stringify({
        kind: "slides-upload",
        version: 1,
        ownerKey: createHash("sha256").update(OWNER).digest("hex").slice(0, 24),
        orgId: "org-one",
        filename: "deck.pdf",
        handle,
      }),
    )}`;

    expect(isAttachmentRef(legacy)).toBe(true);
    expect(attachmentOwnerKey(" Owner@Example.com ")).toBe(
      createHash("sha256").update(OWNER).digest("hex").slice(0, 24),
    );
    const resolved = await resolveAttachment(legacy, {
      ownerEmail: OWNER,
      orgId: "org-one",
    });
    expect(resolved).toMatchObject({
      status: "ok",
      file: { filename: "deck.pdf" },
    });
  });

  it("deletes through the same scope checks", async () => {
    const ref = await mint();

    await expect(
      deleteAttachment(ref, {
        ownerEmail: "other@example.com",
        orgId: "org-one",
      }),
    ).resolves.toMatchObject({ status: "forbiddenScope" });
    expect(provider.blobs.size).toBe(1);
    await expect(
      deleteAttachment(ref, { ownerEmail: OWNER, orgId: "org-one" }),
    ).resolves.toEqual({ status: "ok", deleted: true });
    expect(provider.blobs.size).toBe(0);
  });
});

/**
 * Each cause that used to collapse into "invalid or expired" gets its own
 * outcome, and the choice of outcome decides whether the turn ends.
 */
describe("typed failures", () => {
  const scope = { ownerEmail: OWNER, orgId: "org-one" };

  const CASES: Array<{
    name: string;
    run: () => Promise<{ status: string; reason?: string }>;
    expected: { status: string; reason: string };
  }> = [
    {
      name: "org drift",
      run: async () =>
        resolveAttachment(await mint(), { ...scope, orgId: "org-two" }),
      expected: { status: "forbiddenScope", reason: "org_mismatch" },
    },
    {
      name: "another user's ref",
      run: async () =>
        resolveAttachment(await mint(), {
          ...scope,
          ownerEmail: "other@example.com",
        }),
      expected: { status: "forbiddenScope", reason: "owner_mismatch" },
    },
    {
      name: "decrypt failure (key changed)",
      run: async () => {
        const ref = await mint();
        process.env.SECRETS_ENCRYPTION_KEY = "attachment-key-b";
        return resolveAttachment(ref, scope);
      },
      expected: { status: "expired", reason: "undecryptable" },
    },
    {
      name: "a ref cut short when copied",
      run: async () => {
        const ref = await mint();
        return resolveAttachment(ref.slice(0, ref.length - 40), scope);
      },
      expected: { status: "expired", reason: "undecryptable" },
    },
    {
      name: "a legacy ref that cannot be decrypted",
      run: () =>
        resolveAttachment(`${LEGACY_SLIDES_UPLOAD_REF_PREFIX}not-valid`, scope),
      expected: { status: "expired", reason: "undecryptable" },
    },
    {
      name: "a sealed descriptor with the wrong shape",
      run: () =>
        resolveAttachment(
          `${LEGACY_SLIDES_UPLOAD_REF_PREFIX}${encryptSecretValue(
            JSON.stringify({ kind: "attachment", version: 1 }),
          )}`,
          scope,
        ),
      expected: { status: "malformed", reason: "invalid_shape" },
    },
    {
      name: "missing blob",
      run: async () => {
        const ref = await mint();
        provider.blobs.clear();
        return resolveAttachment(ref, scope);
      },
      expected: { status: "notFound", reason: "blob_missing" },
    },
    {
      name: "blob removed by retention",
      run: async () => {
        const ref = await mint();
        provider.readError = new PrivateBlobError("gone", "gone", {
          status: 410,
        });
        return resolveAttachment(ref, scope);
      },
      expected: { status: "expired", reason: "retention" },
    },
    {
      name: "storage not configured at mint",
      run: async () => {
        unregisterPrivateBlobProvider("memory");
        setPrivateBlobPublicUploadFallbackEnabled(false);
        return mintAttachmentRef({
          data: new Uint8Array([1]),
          filename: "a.pdf",
          mimeType: "application/pdf",
          ownerEmail: OWNER,
          orgId: "org-one",
        });
      },
      expected: { status: "storageUnavailable", reason: "not_configured" },
    },
    {
      name: "the handle's provider is not registered here",
      run: async () => {
        const ref = await mint();
        unregisterPrivateBlobProvider("memory");
        return resolveAttachment(ref, scope);
      },
      expected: { status: "storageUnavailable", reason: "misconfigured" },
    },
    {
      name: "the provider fails with an error nobody typed",
      run: async () => {
        const ref = await mint();
        provider.readError = new Error("socket hang up");
        return resolveAttachment(ref, scope);
      },
      expected: {
        status: "storageUnavailable",
        reason: "provider_unavailable",
      },
    },
    {
      name: "the provider times out reading",
      run: async () => {
        const ref = await mint();
        provider.readError = new PrivateBlobError("timeout", "unavailable");
        return resolveAttachment(ref, scope);
      },
      expected: {
        status: "storageUnavailable",
        reason: "provider_unavailable",
      },
    },
    {
      name: "the deployment has no encryption key",
      run: async () => {
        const ref = await mint();
        delete process.env.SECRETS_ENCRYPTION_KEY;
        delete process.env.BETTER_AUTH_SECRET;
        vi.stubEnv("APP_NAME", undefined);
        vi.stubEnv("NODE_ENV", "production");
        return resolveAttachment(ref, scope);
      },
      expected: {
        status: "storageUnavailable",
        reason: "encryption_key_unavailable",
      },
    },
    {
      name: "an empty reference",
      run: () => resolveAttachment("  ", scope),
      expected: { status: "malformed", reason: "empty" },
    },
    {
      name: "a file name instead of a reference",
      run: () => resolveAttachment("Quarterly report.pdf", scope),
      expected: { status: "malformed", reason: "unrecognized_scheme" },
    },
    {
      name: "a URL instead of a reference",
      run: () =>
        resolveAttachment("https://cdn.example.test/report.pdf", scope),
      expected: { status: "malformed", reason: "unrecognized_scheme" },
    },
  ];

  it.each(CASES)("$name", async ({ run, expected }) => {
    expect(await run()).toMatchObject(expected);
  });

  it("gives org drift, decrypt failure, a missing blob and unconfigured storage four different statuses", () => {
    const statusOf = (name: string) =>
      CASES.find((entry) => entry.name === name)?.expected.status;
    const statuses = [
      statusOf("org drift"),
      statusOf("decrypt failure (key changed)"),
      statusOf("missing blob"),
      statusOf("storage not configured at mint"),
    ];

    expect(new Set(statuses).size).toBe(4);
  });
});

describe("what ends the turn", () => {
  const FAILURES: AttachmentFailure[] = [
    { status: "notFound", reason: "blob_missing", filename: "report.pdf" },
    { status: "notFound", reason: "file_missing" },
    { status: "forbiddenScope", reason: "owner_mismatch" },
    { status: "forbiddenScope", reason: "org_mismatch" },
    { status: "forbiddenScope", reason: "path_outside_uploads" },
    { status: "expired", reason: "undecryptable" },
    { status: "expired", reason: "retention", filename: "report.pdf" },
    { status: "malformed", reason: "empty" },
    { status: "malformed", reason: "unrecognized_scheme" },
    { status: "malformed", reason: "invalid_shape" },
    {
      status: "storageUnavailable",
      reason: "not_configured",
      whoCanFix: "workspace_admin",
    },
    {
      status: "storageUnavailable",
      reason: "misconfigured",
      whoCanFix: "operator",
    },
    {
      status: "storageUnavailable",
      reason: "encryption_key_unavailable",
      whoCanFix: "operator",
    },
    {
      status: "storageUnavailable",
      reason: "provider_unavailable",
      whoCanFix: "self_resolving",
    },
  ];

  it("treats only storageUnavailable as retryable", () => {
    for (const failure of FAILURES) {
      expect(isRetryableAttachmentFailure(failure)).toBe(
        failure.status === "storageUnavailable",
      );
    }
  });

  it.each(FAILURES.filter((f) => f.status !== "storageUnavailable"))(
    "stops the run for definitive $status/$reason with a typed code and HTTP status",
    (failure) => {
      const error = attachmentFailureToError(failure);

      expect(isAgentActionStopError(error)).toBe(true);
      expect(isActionContractError(error)).toBe(false);
      expect(isAttachmentError(error)).toBe(true);
      expect(error).toMatchObject({
        errorCode: "permanent_precondition",
        details: {
          attachmentStatus: failure.status,
          attachmentErrorCode: ATTACHMENT_ERROR_CODES[failure.status],
          reason: failure.reason,
          retryable: false,
        },
      });
      expect([400, 403, 404, 410]).toContain(
        (error as { statusCode: number }).statusCode,
      );
      expect((error as { toolResult?: string }).toolResult).toMatch(
        /Do not retry|Pass the reference/,
      );
    },
  );

  it.each(FAILURES.filter((f) => f.status === "storageUnavailable"))(
    "keeps the run alive for $reason and names who can fix it",
    (failure) => {
      const error = attachmentFailureToError(failure);

      expect(isAgentActionStopError(error)).toBe(false);
      expect(isActionContractError(error)).toBe(true);
      expect(error).toMatchObject({
        errorCode: "attachment_storage_unavailable",
        statusCode: 503,
        details: {
          retryable: true,
          whoCanFix: (failure as { whoCanFix: string }).whoCanFix,
        },
      });
      // Opening says the stored file is intact, so nobody is asked to attach
      // it again; saving has nothing stored to promise.
      expect(error.message).toContain("Your uploaded file is still saved.");
      expect(attachmentFailureToError(failure, "save").message).not.toContain(
        "still saved",
      );
    },
  );

  it("never lets the agent's message heuristics turn an outage into a permanent stop", async () => {
    const { permanentPreconditionRemedy, permanentPreconditionReason } =
      await import("../agent/production-agent.js");

    for (const failure of FAILURES) {
      const description = describeAttachmentFailure(failure);
      const error = attachmentFailureToError(failure);
      if (failure.status === "storageUnavailable") {
        expect(permanentPreconditionRemedy(description.message)).toBeNull();
        expect(permanentPreconditionRemedy(description.toolResult)).toBeNull();
        expect(permanentPreconditionRemedy(error.message)).toBeNull();
        // The string the tool loop actually classifies is the wrapped result.
        expect(
          permanentPreconditionRemedy(
            `Error running import-file: ${error.message} (errorCode: attachment_storage_unavailable)`,
          ),
        ).toBeNull();
        expect(
          permanentPreconditionRemedy(
            describeAttachmentFailure(failure, "save").message,
          ),
        ).toBeNull();
      } else {
        const reason = permanentPreconditionReason(
          "import-file",
          error.message,
        );
        expect(reason).toBeTruthy();
        expect(reason).not.toMatch(/invalid or expired/i);
      }
    }
  });

  it("names the real cause instead of 'invalid or expired'", () => {
    const messages = new Map(
      FAILURES.map((failure) => [
        `${failure.status}/${failure.reason}`,
        describeAttachmentFailure(failure).message,
      ]),
    );

    expect(messages.get("storageUnavailable/not_configured")).toMatch(
      /No object storage is connected/,
    );
    expect(messages.get("storageUnavailable/provider_unavailable")).toMatch(
      /isn't responding/,
    );
    expect(messages.get("forbiddenScope/org_mismatch")).toMatch(
      /different workspace/,
    );
    expect(messages.get("expired/undecryptable")).toMatch(
      /cut short or altered/,
    );
    expect(messages.get("notFound/blob_missing")).toMatch(
      /no longer in file storage/,
    );
    for (const message of messages.values()) {
      expect(message).not.toMatch(/invalid or expired/i);
    }
  });

  it("round-trips the unwrap helper", () => {
    expect(() =>
      unwrapAttachment({ status: "notFound", reason: "blob_missing" }),
    ).toThrow(/no longer in file storage/);
    const file = { data: Buffer.from("x"), filename: "a.pdf", size: 1 };
    expect(unwrapAttachment({ status: "ok", file })).toBe(file);
  });
});

describe("attachment outcome counts", () => {
  const scope = { ownerEmail: OWNER, orgId: "org-one" };

  beforeEach(() => {
    countOutcomeMock.mockClear();
  });

  it("counts a successful mint and resolve, so a failure is a rate", async () => {
    const ref = await mint();
    await resolveAttachment(ref, scope);

    expect(countOutcomeMock.mock.calls.map(([call]) => call)).toEqual([
      { operation: "mint", status: "ok" },
      { operation: "resolve", status: "ok" },
    ]);
  });

  it("counts each typed failure under its own status and reason, and the outage with who can fix it", async () => {
    const ref = await mint();
    countOutcomeMock.mockClear();

    await resolveAttachment(ref, { ...scope, orgId: "org-two" });
    await resolveAttachment("Quarterly report.pdf", scope);
    provider.readError = new PrivateBlobError("down", "unavailable");
    await resolveAttachment(ref, scope);

    expect(countOutcomeMock.mock.calls.map(([call]) => call)).toEqual([
      {
        operation: "resolve",
        status: "forbiddenScope",
        reason: "org_mismatch",
      },
      {
        operation: "resolve",
        status: "malformed",
        reason: "unrecognized_scheme",
      },
      {
        operation: "resolve",
        status: "storageUnavailable",
        reason: "provider_unavailable",
        whoCanFix: "self_resolving",
      },
    ]);
  });

  it("never puts the reference, the file name or the owner in a count", async () => {
    const ref = await mint({ filename: "secret-report.pdf" });
    await resolveAttachment(ref, { ...scope, ownerEmail: "other@example.com" });

    const counted = JSON.stringify(countOutcomeMock.mock.calls);
    expect(counted).not.toContain(ref.slice(0, 30));
    expect(counted).not.toContain("secret-report");
    expect(counted).not.toContain("example.com");
  });
});

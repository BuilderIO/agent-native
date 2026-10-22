import { describe, expect, it, vi } from "vitest";

import {
  abandonUploadTarget,
  hostedUploadLimits,
  openUploadTarget,
  prepareCaptureAfterUploadTarget,
  retryDropUploadTargetRow,
  UploadTargetError,
} from "./upload-target";

describe("openUploadTarget", () => {
  const target = {
    id: "srv-1",
    uploadChunkUrl: "/api/uploads/srv-1/chunk",
    abortUrl: "/api/uploads/srv-1/abort",
  };

  function open(
    create: (extra: {
      id?: string;
      expectedOwnerEmail?: string;
    }) => Promise<Response>,
    ownerEmail: string | null = "me@example.com",
    onCreateFailed?: NonNullable<
      Parameters<typeof openUploadTarget>[0]["onCreateFailed"]
    >,
    dropRow = vi.fn(async () => {}),
  ) {
    const result = openUploadTarget({
      intake: false,
      ownerEmail,
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => ({
        configured: true,
        mode: "own",
        hostedRemaining: 0,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      }),
      create,
      dropRow,
      onCreateFailed,
    });
    return { result, dropRow };
  }

  function openIntake(create: () => Promise<Response>) {
    const dropRow = vi.fn(async () => {});
    const result = openUploadTarget({
      intake: true,
      ownerEmail: null,
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => null,
      create,
      dropRow,
    });
    return { result, dropRow };
  }

  it("opens the row for the account signed in when capture started", async () => {
    const create = vi.fn(async () => Response.json({ result: target }));
    const { result } = open(create);

    await expect(result).resolves.toEqual(target);
    expect(create).toHaveBeenCalledWith({
      id: "srv-1",
      expectedOwnerEmail: "me@example.com",
    });
  });

  it("allows local SQL scratch when no external storage is connected", async () => {
    const result = openUploadTarget({
      intake: false,
      ownerEmail: "me@example.com",
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => ({
        configured: false,
        localSqlChunkScratchAvailable: true,
        mode: "none",
        hostedRemaining: 0,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      }),
      create: async () => Response.json({ result: target }),
      dropRow: vi.fn(async () => {}),
    });

    await expect(result).resolves.toEqual(target);
  });

  it("stops when another account signed in since capture began", async () => {
    const { result, dropRow } = open(async () =>
      Response.json(
        { error: "This recording belongs to another account." },
        { status: 409 },
      ),
    );

    await expect(result).rejects.toMatchObject({
      code: "upload_target_unavailable",
    });
    expect(dropRow).not.toHaveBeenCalled();
  });

  it("stops when storage rejects upload creation", async () => {
    const onCreateFailed = vi.fn();
    const dropRow = vi.fn(async () => {});
    const result = openUploadTarget({
      intake: false,
      ownerEmail: "me@example.com",
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => ({
        configured: true,
        mode: "own",
        hostedRemaining: 0,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      }),
      create: async () =>
        Response.json(
          { error: "Video storage is not connected yet." },
          { status: 503 },
        ),
      dropRow,
      onCreateFailed,
    });

    await expect(result).rejects.toMatchObject({
      code: "upload_target_unavailable",
    });
    expect(dropRow).not.toHaveBeenCalled();
    expect(onCreateFailed).toHaveBeenCalledWith({
      kind: "http",
      status: 503,
    });
  });

  it.each([
    { status: 403, errorCode: "disabled", denyReason: "disabled" },
    { status: 402, errorCode: "exhausted", denyReason: "exhausted" },
    {
      status: 503,
      errorCode: "storage_setup_required",
      denyReason: undefined,
    },
  ])(
    "routes the $errorCode storage denial back to setup",
    async ({ status, errorCode, denyReason }) => {
      const onCreateFailed = vi.fn();
      const { result, dropRow } = open(
        async () =>
          Response.json(
            {
              error: "Storage is unavailable.",
              errorCode,
              ...(denyReason ? { details: { denyReason } } : {}),
            },
            { status },
          ),
        "me@example.com",
        onCreateFailed,
      );

      await expect(result).rejects.toMatchObject({
        code: "storage_setup_required",
      });
      expect(dropRow).not.toHaveBeenCalled();
      expect(onCreateFailed).toHaveBeenCalledWith({
        kind: "http",
        status,
        storageSetupRequired: true,
      });
    },
  );

  it("keeps unrelated authorization denials separate from storage setup", async () => {
    const { result } = open(async () =>
      Response.json(
        { error: "Forbidden", errorCode: "forbidden" },
        { status: 403 },
      ),
    );

    await expect(result).rejects.toMatchObject({ code: "session_expired" });
  });

  it("preserves a typed account mismatch from upload creation", async () => {
    const onCreateFailed = vi.fn();
    const { result, dropRow } = open(
      async () =>
        Response.json(
          {
            error: "This recording belongs to another account.",
            errorCode: "recording_owner_mismatch",
          },
          { status: 409 },
        ),
      "me@example.com",
      onCreateFailed,
    );

    await expect(result).rejects.toMatchObject({
      code: "recording_owner_mismatch",
    });
    expect(dropRow).not.toHaveBeenCalled();
    expect(onCreateFailed).toHaveBeenCalledWith({
      kind: "http",
      status: 409,
    });
  });

  it("preserves hosted storage outages as a distinct upload-target error", async () => {
    const onCreateFailed = vi.fn();
    const { result, dropRow } = open(
      async () =>
        Response.json(
          {
            error: "Clips hosted storage is temporarily unavailable.",
            errorCode: "hosted_storage_unavailable",
            details: { retryable: true, cleanupConfirmed: false },
          },
          { status: 503 },
        ),
      "me@example.com",
      onCreateFailed,
    );

    await expect(result).rejects.toMatchObject({
      code: "hosted_storage_unavailable",
    });
    expect(dropRow).not.toHaveBeenCalled();
    expect(onCreateFailed).toHaveBeenCalledWith({
      kind: "http",
      status: 503,
    });
  });

  it("preserves required resumable-upload failures as a distinct error", async () => {
    const { result, dropRow } = open(async () =>
      Response.json(
        {
          error: "The current storage setup cannot start the upload.",
          errorCode: "streaming_upload_unavailable",
        },
        { status: 503 },
      ),
    );

    await expect(result).rejects.toMatchObject({
      code: "streaming_upload_unavailable",
    });
    expect(dropRow).not.toHaveBeenCalled();
  });

  it.each([
    { cleanupConfirmed: undefined, recordingId: undefined },
    { cleanupConfirmed: false, recordingId: "srv-1" },
    { cleanupConfirmed: true, recordingId: undefined },
    { cleanupConfirmed: true, recordingId: "other-recording" },
  ])(
    "preserves a failed upload row without matching confirmed cleanup ($cleanupConfirmed, $recordingId)",
    async ({ cleanupConfirmed, recordingId }) => {
      const { result, dropRow } = open(async () =>
        Response.json(
          {
            errorCode: "hosted_storage_unavailable",
            details: { cleanupConfirmed, recordingId },
          },
          { status: 503 },
        ),
      );

      await expect(result).rejects.toMatchObject({
        code: "hosted_storage_unavailable",
      });
      expect(dropRow).not.toHaveBeenCalled();
    },
  );

  it("retries row cleanup when a failed create confirms cleanup is safe", async () => {
    vi.useFakeTimers();
    try {
      const dropRow = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("temporary trash failure"))
        .mockResolvedValueOnce();
      const { result } = open(
        async () =>
          Response.json(
            {
              errorCode: "hosted_storage_unavailable",
              details: {
                recordingId: "srv-1",
                retryable: true,
                cleanupConfirmed: true,
              },
            },
            { status: 503 },
          ),
        "me@example.com",
        undefined,
        dropRow,
      );

      await expect(result).rejects.toMatchObject({
        code: "hosted_storage_unavailable",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(dropRow).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(dropRow).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not prepare capture when upload-target creation rejects", async () => {
    const failure = new UploadTargetError("storage_setup_required");
    const resolveTarget = async (): Promise<typeof target | null> => {
      throw failure;
    };
    const prepareCapture = vi.fn(async (_target: typeof target) => {});

    await expect(
      prepareCaptureAfterUploadTarget(resolveTarget, prepareCapture),
    ).rejects.toBe(failure);
    expect(prepareCapture).not.toHaveBeenCalled();
  });

  it("drops the row a lost response may have left, then stops", async () => {
    vi.useFakeTimers();
    try {
      const dropRow = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("recording not found"))
        .mockResolvedValueOnce();
      const { result } = open(
        async () => {
          throw new TypeError("Failed to fetch");
        },
        "me@example.com",
        undefined,
        dropRow,
      );

      await expect(result).rejects.toMatchObject({
        code: "upload_target_unavailable",
      });
      expect(dropRow).toHaveBeenCalledTimes(1);
      expect(dropRow).toHaveBeenCalledWith("srv-1");
      await vi.advanceTimersByTimeAsync(500);
      expect(dropRow).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying upload-row cleanup after it succeeds", async () => {
    vi.useFakeTimers();
    try {
      const dropRow = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("recording not found"))
        .mockResolvedValueOnce();
      const cleanup = retryDropUploadTargetRow("srv-1", dropRow);

      expect(dropRow).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      await expect(cleanup).resolves.toBe(true);
      expect(dropRow).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps a timed-out intake create to a typed start error", async () => {
    const result = openUploadTarget({
      intake: true,
      ownerEmail: null,
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => null,
      create: async () => {
        throw new DOMException(
          "Upload target request timed out",
          "TimeoutError",
        );
      },
      dropRow: vi.fn(async () => {}),
    });

    await expect(result).rejects.toMatchObject({
      code: "upload_target_unavailable",
    });
  });

  it.each([
    {
      status: 403,
      errorCode: "sign_in_required",
      expected: "intake_storage_unavailable",
    },
    {
      status: 403,
      errorCode: "forbidden",
      denyReason: "disabled",
      expected: "intake_storage_unavailable",
    },
    {
      status: 503,
      errorCode: "hosted_storage_unavailable",
      expected: "hosted_storage_unavailable",
    },
    {
      status: 409,
      errorCode: "recording_owner_mismatch",
      expected: "recording_owner_mismatch",
    },
    {
      status: 503,
      errorCode: "streaming_upload_unavailable",
      expected: "streaming_upload_unavailable",
    },
  ])(
    "maps typed intake denial $errorCode before status fallback",
    async ({ status, errorCode, denyReason, expected }) => {
      const { result } = openIntake(async () =>
        Response.json(
          {
            error: "Storage needs attention.",
            errorCode,
            ...(denyReason ? { details: { denyReason } } : {}),
          },
          { status },
        ),
      );

      await expect(result).rejects.toMatchObject({ code: expected });
    },
  );

  it("uses session-expired recovery for an untyped intake authorization error", async () => {
    const { result } = openIntake(async () =>
      Response.json({ error: "Forbidden" }, { status: 403 }),
    );

    await expect(result).rejects.toMatchObject({ code: "session_expired" });
  });

  it("requires an owner before opening an upload row", async () => {
    const create = vi.fn();
    const { result } = open(create, null);

    await expect(result).rejects.toMatchObject({ code: "session_expired" });
    expect(create).not.toHaveBeenCalled();
  });

  it("stops when storage status cannot be read", async () => {
    const result = openUploadTarget({
      intake: false,
      ownerEmail: "me@example.com",
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => {
        throw new Error("storage status request failed");
      },
      create: vi.fn(),
      dropRow: vi.fn(async () => {}),
    });

    await expect(result).rejects.toMatchObject({
      code: "storage_status_unavailable",
    });
  });

  it("keeps hosted limits with the upload target, without limiting own storage", async () => {
    const create = vi.fn(async () => Response.json({ result: target }));
    const hosted = openUploadTarget({
      intake: false,
      ownerEmail: "me@example.com",
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => ({
        configured: true,
        mode: "hosted",
        hostedRemaining: 3,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      }),
      create,
      dropRow: vi.fn(async () => {}),
    });
    await expect(hosted).resolves.toMatchObject({
      id: "srv-1",
      clientLimits: {
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      },
    });

    const own = openUploadTarget({
      intake: false,
      ownerEmail: "me@example.com",
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => ({
        configured: true,
        mode: "own",
        hostedRemaining: 0,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      }),
      create,
      dropRow: vi.fn(async () => {}),
    });
    await expect(own).resolves.toEqual(target);
  });

  it("requires storage after hosted trial clips are exhausted", async () => {
    const create = vi.fn();
    const result = openUploadTarget({
      intake: false,
      ownerEmail: "me@example.com",
      newId: () => "srv-1",
      isStale: () => false,
      fetchStatus: async () => ({
        configured: false,
        mode: "none",
        hostedRemaining: 0,
        maxClipBytes: 250 * 1024 * 1024,
        maxClipDurationMs: 10 * 60 * 1000,
      }),
      create,
      dropRow: vi.fn(async () => {}),
    });

    await expect(result).rejects.toMatchObject({
      code: "storage_setup_required",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("abandonUploadTarget", () => {
  it("trashes the row of a recorder that could not start", async () => {
    const abandon = vi.fn(async () => ({}));
    const abort = vi.fn(async () => ({}));

    await abandonUploadTarget(
      { id: "srv-1", abortUrl: "/api/uploads/srv-1/abort" },
      { intake: false, abandon, abort },
    );

    expect(abandon).toHaveBeenCalledWith("srv-1");
    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts an intake row, and leaves a local-only take alone", async () => {
    const abandon = vi.fn(async () => ({}));
    const abort = vi.fn(async () => ({}));

    await abandonUploadTarget(
      { id: "srv-1", abortUrl: "/abort" },
      { intake: true, abandon, abort },
    );
    expect(abort).toHaveBeenCalledWith("/abort");

    expect(
      abandonUploadTarget(
        { id: "local-1", abortUrl: "", localOnly: true },
        { intake: false, abandon, abort },
      ),
    ).toBeNull();
    expect(abandon).not.toHaveBeenCalled();
  });
});

describe("hostedUploadLimits", () => {
  const caps = {
    configured: true,
    hostedRemaining: 2,
    maxClipBytes: 250,
    maxClipDurationMs: 600_000,
  };

  it("limits hosted uploads to the hosted caps", () => {
    expect(hostedUploadLimits({ ...caps, mode: "hosted" })).toEqual({
      maxClipBytes: 250,
      maxClipDurationMs: 600_000,
    });
  });

  it("does not apply the hosted caps to own storage or an unreadable status", () => {
    expect(hostedUploadLimits({ ...caps, mode: "own" })).toBeNull();
    expect(hostedUploadLimits(null)).toBeNull();
  });
});

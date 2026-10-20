import { describe, expect, it, vi } from "vitest";

import {
  abandonUploadTarget,
  hostedUploadLimits,
  openUploadTarget,
  prepareCaptureAfterUploadTarget,
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
  ) {
    const dropRow = vi.fn();
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

  it("opens the row for the account signed in when capture started", async () => {
    const create = vi.fn(async () => Response.json({ result: target }));
    const { result } = open(create);

    await expect(result).resolves.toEqual(target);
    expect(create).toHaveBeenCalledWith({
      id: "srv-1",
      expectedOwnerEmail: "me@example.com",
    });
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
    expect(dropRow).toHaveBeenCalledWith("srv-1");
  });

  it("stops when storage rejects upload creation", async () => {
    const onCreateFailed = vi.fn();
    const dropRow = vi.fn();
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
    expect(dropRow).toHaveBeenCalledWith("srv-1");
    expect(onCreateFailed).toHaveBeenCalledWith({
      kind: "http",
      status: 503,
    });
  });

  it.each([
    { status: 403, errorCode: "disabled" },
    { status: 402, errorCode: "exhausted" },
  ])(
    "routes the $errorCode storage denial back to setup",
    async ({ status, errorCode }) => {
      const onCreateFailed = vi.fn();
      const { result, dropRow } = open(
        async () =>
          Response.json(
            {
              error: "Storage is unavailable.",
              errorCode,
              details: { denyReason: errorCode },
            },
            { status },
          ),
        "me@example.com",
        onCreateFailed,
      );

      await expect(result).rejects.toMatchObject({
        code: "storage_setup_required",
      });
      expect(dropRow).toHaveBeenCalledWith("srv-1");
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
    const { result, dropRow } = open(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(result).rejects.toMatchObject({
      code: "upload_target_unavailable",
    });
    expect(dropRow).toHaveBeenCalledWith("srv-1");
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
      dropRow: vi.fn(),
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
      dropRow: vi.fn(),
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
      dropRow: vi.fn(),
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
      dropRow: vi.fn(),
    });

    await expect(result).rejects.toMatchObject({
      code: "storage_setup_required",
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("abandonUploadTarget", () => {
  it("trashes the row of a recorder that could not start", async () => {
    const trash = vi.fn(async () => ({}));
    const abort = vi.fn(async () => ({}));

    await abandonUploadTarget(
      { id: "srv-1", abortUrl: "/api/uploads/srv-1/abort" },
      { intake: false, trash, abort },
    );

    expect(trash).toHaveBeenCalledWith("srv-1");
    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts an intake row, and leaves a local-only take alone", async () => {
    const trash = vi.fn(async () => ({}));
    const abort = vi.fn(async () => ({}));

    await abandonUploadTarget(
      { id: "srv-1", abortUrl: "/abort" },
      { intake: true, trash, abort },
    );
    expect(abort).toHaveBeenCalledWith("/abort");

    expect(
      abandonUploadTarget(
        { id: "local-1", abortUrl: "", localOnly: true },
        { intake: false, trash, abort },
      ),
    ).toBeNull();
    expect(trash).not.toHaveBeenCalled();
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

import { describe, expect, it, vi } from "vitest";

import {
  abandonUploadTarget,
  hostedUploadLimits,
  openUploadTarget,
  uploadTargetAtStart,
} from "./upload-target";

describe("uploadTargetAtStart", () => {
  it("uses a target that settled during the countdown", async () => {
    const onLate = vi.fn();
    const target = Promise.resolve({ id: "srv-1" });
    await target;

    await expect(uploadTargetAtStart(target, onLate)).resolves.toEqual({
      id: "srv-1",
    });
    expect(onLate).not.toHaveBeenCalled();
  });

  it("starts capture at once when the storage status never answers", async () => {
    const hung = new Promise<{ id: string } | null>(() => {});

    const started = Date.now();
    await expect(uploadTargetAtStart(hung, vi.fn())).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("hands a row that opens after capture started over for cleanup", async () => {
    let open!: (value: { id: string } | null) => void;
    const slow = new Promise<{ id: string } | null>((resolve) => {
      open = resolve;
    });
    const onLate = vi.fn();

    await expect(uploadTargetAtStart(slow, onLate)).resolves.toBeNull();
    open({ id: "srv-late" });
    await vi.waitFor(() =>
      expect(onLate).toHaveBeenCalledWith({ id: "srv-late" }),
    );
  });
});

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

  it("records locally, with no row, when another account signed in since capture began", async () => {
    const { result, dropRow } = open(async () =>
      Response.json(
        { error: "This recording belongs to another account." },
        { status: 409 },
      ),
    );

    await expect(result).resolves.toBeNull();
    expect(dropRow).toHaveBeenCalledWith("srv-1");
  });

  it("keeps capture local when storage rejects upload creation", async () => {
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

    await expect(result).resolves.toBeNull();
    expect(dropRow).toHaveBeenCalledWith("srv-1");
    expect(onCreateFailed).toHaveBeenCalledWith({
      kind: "http",
      status: 503,
    });
  });

  it("drops the row a lost response may have left, and records locally", async () => {
    const { result, dropRow } = open(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(result).resolves.toBeNull();
    expect(dropRow).toHaveBeenCalledWith("srv-1");
  });

  it("never opens a row for a take with no owner at capture", async () => {
    const create = vi.fn();
    const { result } = open(create, null);

    await expect(result).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
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

  it("does not create an upload row after hosted trial clips are exhausted", async () => {
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

    await expect(result).resolves.toBeNull();
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

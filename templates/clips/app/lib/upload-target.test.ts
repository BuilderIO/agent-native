import { describe, expect, it, vi } from "vitest";

import {
  abandonUploadTarget,
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
      fetchStatus: async () => ({ configured: true }),
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

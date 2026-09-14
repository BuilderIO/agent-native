import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  loadYDocRecord: vi.fn(),
  loadYDocState: vi.fn(),
  loadYDocVersion: vi.fn(),
  saveYDocState: vi.fn(),
  trySaveYDocState: vi.fn(),
  trySaveYDocStateWithClient: vi.fn(),
}));

const emitterMocks = vi.hoisted(() => ({ emitCollabUpdate: vi.fn() }));

vi.mock("./storage.js", () => ({
  ...storageMocks,
  uint8ArrayToBase64: (value: Uint8Array) =>
    Buffer.from(value).toString("base64"),
}));

vi.mock("./emitter.js", () => ({
  emitCollabUpdate: emitterMocks.emitCollabUpdate,
}));

describe("ydoc-manager", () => {
  beforeEach(() => {
    vi.resetModules();
    storageMocks.loadYDocRecord.mockReset();
    storageMocks.saveYDocState.mockReset();
    storageMocks.trySaveYDocState.mockReset();
    storageMocks.trySaveYDocStateWithClient.mockReset();
    storageMocks.loadYDocState.mockReset();
    storageMocks.loadYDocVersion.mockReset();
    emitterMocks.emitCollabUpdate.mockReset();
  });

  it("coalesces concurrent cache-miss loads for the same document", async () => {
    storageMocks.loadYDocRecord.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return null;
    });
    // "no row", the same answer loadYDocRecord gives above. Left unset it
    // resolves undefined, which reads as a moved version and sends the cold
    // load's staleness re-check round again.
    storageMocks.loadYDocVersion.mockResolvedValue(null);

    const { getDoc } = await import("./ydoc-manager.js");
    const [first, second] = await Promise.all([
      getDoc("concurrent-doc"),
      getDoc("concurrent-doc"),
    ]);

    expect(first).toBe(second);
    expect(storageMocks.loadYDocRecord).toHaveBeenCalledTimes(1);
  });

  it("publishes a prepared clone only after transactional persistence", async () => {
    storageMocks.loadYDocRecord.mockResolvedValue(null);
    storageMocks.loadYDocVersion.mockResolvedValue(null);
    storageMocks.trySaveYDocStateWithClient.mockResolvedValue(true);
    const tx = { execute: vi.fn() };
    const { getDoc, withPreparedYDocMutation } =
      await import("./ydoc-manager.js");

    await withPreparedYDocMutation("prepared-doc", "agent", async (lease) => {
      lease.doc.getText("content").insert(0, "accepted");
      expect(emitterMocks.emitCollabUpdate).not.toHaveBeenCalled();
      await lease.persist(tx, "accepted");
      expect(emitterMocks.emitCollabUpdate).not.toHaveBeenCalled();
    });

    expect(storageMocks.trySaveYDocStateWithClient).toHaveBeenCalledWith(
      tx,
      "prepared-doc",
      expect.any(Uint8Array),
      "accepted",
      null,
    );
    expect(emitterMocks.emitCollabUpdate).toHaveBeenCalledOnce();
    expect((await getDoc("prepared-doc")).getText("content").toString()).toBe(
      "accepted",
    );
  });

  it("discards a prepared clone when the caller transaction rolls back", async () => {
    storageMocks.loadYDocRecord.mockResolvedValue(null);
    storageMocks.loadYDocVersion.mockResolvedValue(null);
    storageMocks.trySaveYDocStateWithClient.mockResolvedValue(true);
    const { getDoc, withPreparedYDocMutation } =
      await import("./ydoc-manager.js");
    const current = await getDoc("rollback-doc");
    current.getText("content").insert(0, "before");

    await expect(
      withPreparedYDocMutation("rollback-doc", "agent", async (lease) => {
        lease.doc.getText("content").insert(6, "-candidate");
        await lease.persist({ execute: vi.fn() }, "before-candidate");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(emitterMocks.emitCollabUpdate).not.toHaveBeenCalled();
    expect((await getDoc("rollback-doc")).getText("content").toString()).toBe(
      "before",
    );
  });
});

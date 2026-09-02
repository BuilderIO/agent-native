import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  loadYDocRecord: vi.fn(),
  loadYDocState: vi.fn(),
  loadYDocVersion: vi.fn(),
  saveYDocState: vi.fn(),
  trySaveYDocState: vi.fn(),
}));

vi.mock("./storage.js", () => ({
  ...storageMocks,
  uint8ArrayToBase64: (value: Uint8Array) =>
    Buffer.from(value).toString("base64"),
}));

vi.mock("./emitter.js", () => ({
  emitCollabUpdate: vi.fn(),
}));

describe("ydoc-manager", () => {
  beforeEach(() => {
    vi.resetModules();
    storageMocks.loadYDocRecord.mockReset();
    storageMocks.saveYDocState.mockReset();
    storageMocks.trySaveYDocState.mockReset();
    storageMocks.loadYDocState.mockReset();
    storageMocks.loadYDocVersion.mockReset();
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
});

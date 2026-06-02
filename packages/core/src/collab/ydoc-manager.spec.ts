import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => ({
  loadYDocRecord: vi.fn(),
  loadYDocState: vi.fn(),
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
  });

  it("coalesces concurrent cache-miss loads for the same document", async () => {
    storageMocks.loadYDocState.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return null;
    });

    const { getDoc } = await import("./ydoc-manager.js");
    const [first, second] = await Promise.all([
      getDoc("concurrent-doc"),
      getDoc("concurrent-doc"),
    ]);

    expect(first).toBe(second);
    expect(storageMocks.loadYDocState).toHaveBeenCalledTimes(1);
  });
});

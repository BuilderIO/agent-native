import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

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

  it.each(["update", "text", "search-replace", "json", "patch"])(
    "discards a rejected %s mutation before a later successful write",
    async (operation) => {
      const initial = new Y.Doc();
      initial.getText("content").insert(0, "original");
      initial.getMap("data").set("title", "original");
      const paragraph = new Y.XmlElement("paragraph");
      const xmlText = new Y.XmlText();
      xmlText.insert(0, "original");
      paragraph.insert(0, [xmlText]);
      initial.getXmlFragment("default").insert(0, [paragraph]);
      let state = Y.encodeStateAsUpdate(initial);
      let version = 0;
      storageMocks.loadYDocRecord.mockImplementation(async () => ({
        state,
        version,
      }));
      storageMocks.loadYDocVersion.mockImplementation(async () => version);
      storageMocks.trySaveYDocState.mockRejectedValueOnce(
        Object.assign(new Error("Document is in Trash."), {
          code: "DOCUMENT_TRASHED",
          statusCode: 409,
        }),
      );
      const manager = await import("./ydoc-manager.js");
      const { emitCollabUpdate } = await import("./emitter.js");
      vi.mocked(emitCollabUpdate).mockClear();
      let rejected: Promise<unknown>;
      if (operation === "update") {
        const peer = new Y.Doc();
        Y.applyUpdate(peer, state);
        peer.getText("content").insert(0, "rejected ");
        rejected = manager.applyUpdate(
          "example-doc",
          Y.encodeStateAsUpdate(peer),
        );
        peer.destroy();
      } else if (operation === "text") {
        rejected = manager.applyText("example-doc", "rejected");
      } else if (operation === "search-replace") {
        rejected = manager.searchAndReplace(
          "example-doc",
          "original",
          "rejected",
        );
      } else if (operation === "json") {
        rejected = manager.applyJson("example-doc", { title: "rejected" });
      } else {
        rejected = manager.applyPatchOps("example-doc", [
          { op: "set", path: "title", value: "rejected" },
        ]);
      }
      await expect(rejected).rejects.toMatchObject({
        code: "DOCUMENT_TRASHED",
      });
      expect(emitCollabUpdate).not.toHaveBeenCalled();
      const restored = await manager.getDoc("example-doc");
      expect(restored.getText("content").toString()).toBe("original");
      expect(restored.getMap("data").get("title")).toBe("original");
      expect(restored.getXmlFragment("default").toString()).not.toContain(
        "rejected",
      );
      storageMocks.trySaveYDocState.mockImplementation(
        async (_id, nextState) => {
          state = nextState;
          version++;
          return true;
        },
      );
      await manager.applyText("example-doc", "accepted");
      expect(emitCollabUpdate).toHaveBeenCalledTimes(1);
      const persisted = new Y.Doc();
      Y.applyUpdate(persisted, state);
      expect(persisted.getMap("data").get("title")).toBe("original");
      expect(persisted.getXmlFragment("default").toString()).not.toContain(
        "rejected",
      );
      expect(persisted.getText("content").toString()).toBe("accepted");
      manager.releaseDoc("example-doc");
      initial.destroy();
      persisted.destroy();
    },
  );
});

// @vitest-environment happy-dom

// oracle-change(templates/design/app/pages/design-editor/commands/import-figma-clipboard-into-design.spec.ts): Figma copies decode in the browser and share this command with Paper and Wonder, so the server-result and Figma access-failure cases no longer exist; image notice, warnings, screen focus and board/in-canvas placement are asserted here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const callAction = vi.fn();
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
}));
const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
const logged = vi.spyOn(console, "error").mockImplementation(() => {});
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
    loading: () => "progress",
    dismiss: () => {},
  },
}));

import type { FigmaPasteScene } from "@shared/figma-paste-plan";

import type { DesignToolPaste } from "@/lib/design-tool-paste";

import {
  runImportDesignToolPasteIntoDesign,
  type ImportDesignToolPasteArgs,
} from "./import-design-tool-paste-into-design";

const layer = (title: string) => ({
  title,
  width: 100,
  height: 80,
  content: `<!DOCTYPE html><html><head></head><body><div data-agent-native-layer-name="${title}"></div></body></html>`,
  wrapsLooseNode: false,
  origin: { x: 0, y: 0 },
  sourceOffset: null,
});

const paste = (over: Partial<DesignToolPaste> = {}): DesignToolPaste => ({
  status: "ok",
  tool: "wonder",
  layers: [layer("Card")],
  warnings: [],
  ...over,
});

const insideScreen: FigmaPasteScene = {
  container: {
    fileId: "screen-1",
    selector: null,
    width: 1000,
    height: 800,
    visible: { x: 0, y: 0, width: 1000, height: 800 },
    autoLayout: false,
  },
  viewport: null,
  screens: [],
};

const noTarget: FigmaPasteScene = {
  container: null,
  viewport: null,
  screens: [],
};

const onBoard: FigmaPasteScene = {
  container: null,
  viewport: { x: 0, y: 0, width: 2000, height: 1200 },
  screens: [],
};

function setup(
  scene: FigmaPasteScene,
  over: Partial<ImportDesignToolPasteArgs> = {},
) {
  const insertPasteLayers = vi.fn(
    (_fileId: string, _selector: string | null, _layers: unknown[]) => true,
  );
  const navigate = vi.fn();
  const showPastedImagesNotice = vi.fn();
  const settleImage = vi.fn(
    async (_key: string, _mode: "release" | "delete") => {},
  );
  const args: ImportDesignToolPasteArgs = {
    boardFileId: "board",
    canEditDesign: true,
    id: "design-1",
    insertPasteLayers,
    mirrorImage: async () => {
      throw new Error("file storage is not set up");
    },
    navigate,
    queryClient: { invalidateQueries: vi.fn() } as never,
    resolvePasteScene: () => scene,
    settleImage,
    showPastedImagesNotice,
    t: (key) => key,
    ...over,
  };
  return {
    args,
    insertPasteLayers,
    navigate,
    settleImage,
    showPastedImagesNotice,
  };
}

beforeEach(() => {
  callAction.mockReset();
  toastError.mockClear();
  warn.mockClear();
  logged.mockClear();
  toastWarning.mockClear();
});

describe("a design-tool paste placed inside a screen", () => {
  it("inserts where the plan says without creating a screen", async () => {
    const { args, insertPasteLayers } = setup(insideScreen);
    await runImportDesignToolPasteIntoDesign(args, paste());
    expect(callAction).not.toHaveBeenCalled();
    expect(insertPasteLayers).toHaveBeenCalledWith("screen-1", null, [
      expect.objectContaining({ position: expect.any(Object) }),
    ]);
  });

  it("hands unloaded images to the notice with the screen they landed in", async () => {
    const { args, showPastedImagesNotice } = setup(insideScreen);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ tool: "figma", unresolvedImages: 3 }),
    );
    expect(showPastedImagesNotice).toHaveBeenCalledWith({
      count: 3,
      fileIds: ["screen-1"],
    });
  });

  it("shows no notice when every image came through", async () => {
    const { args, showPastedImagesNotice } = setup(insideScreen);
    await runImportDesignToolPasteIntoDesign(args, paste({ tool: "figma" }));
    expect(showPastedImagesNotice).not.toHaveBeenCalled();
  });

  it("raises what the converter could not carry over as a warning", async () => {
    const { args } = setup(insideScreen);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ warnings: [{ kind: "inexact", detail: "Skipped a color" }] }),
    );
    expect(toastWarning).toHaveBeenCalledWith(
      "designEditor.import.warningsToast",
      { description: "designEditor.import.pasteInexact" },
    );
  });

  it("says so when the layers cannot be inserted", async () => {
    const { args } = setup(insideScreen, { insertPasteLayers: () => false });
    await runImportDesignToolPasteIntoDesign(args, paste());
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.wonderPasteFailed",
      { description: "designEditor.toasts.primitiveInsertFailed" },
    );
  });

  it("names Figma when a Figma paste cannot be inserted", async () => {
    const { args } = setup(insideScreen, { insertPasteLayers: () => false });
    await runImportDesignToolPasteIntoDesign(args, paste({ tool: "figma" }));
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.figmaPasteFailed",
      expect.any(Object),
    );
  });
});

describe("a design-tool paste that links remote images", () => {
  const remote = "https://cdn.example.test/a.png";
  const withImage = (): DesignToolPaste =>
    paste({
      layers: [
        {
          ...layer("Card"),
          content: `<!DOCTYPE html><html><head></head><body><div style="background-image:url(&quot;${remote}&quot;)"></div></body></html>`,
        },
      ],
      remoteImages: [remote],
    });

  it("hosts the image and inserts the hosted link", async () => {
    const { args, insertPasteLayers } = setup(insideScreen, {
      mirrorImage: async () => "https://files.test/a.png",
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    const [, , inserts] = insertPasteLayers.mock.calls[0] ?? [];
    expect(JSON.stringify(inserts)).toContain("https://files.test/a.png");
    expect(JSON.stringify(inserts)).not.toContain("cdn.example.test");
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("keeps the link and says so when it cannot be hosted", async () => {
    const { args, insertPasteLayers } = setup(insideScreen);
    await runImportDesignToolPasteIntoDesign(args, withImage());
    const [, , inserts] = insertPasteLayers.mock.calls[0] ?? [];
    expect(JSON.stringify(inserts)).toContain("cdn.example.test");
    expect(toastWarning).toHaveBeenCalledWith(
      "designEditor.import.warningsToast",
      { description: "designEditor.import.pasteImagesLinked" },
    );
  });

  it("releases the upload receipts once the layers are inserted", async () => {
    const keys: string[] = [];
    const { args, settleImage } = setup(insideScreen, {
      mirrorImage: async (_url, key) => {
        keys.push(key);
        return "https://files.test/a.png";
      },
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^images:[^:]+:0$/);
    expect(settleImage).toHaveBeenCalledWith(keys[0], "release");
    expect(settleImage).not.toHaveBeenCalledWith(keys[0], "delete");
  });

  it("retries a release that is not confirmed, then warns the images may expire", async () => {
    const failing = vi.fn(async (_key: string, _mode: "release" | "delete") => {
      throw new Error("the upload was not confirmed as kept");
    });
    const { args } = setup(insideScreen, {
      mirrorImage: async () => "https://files.test/a.png",
      settleImage: failing,
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(failing).toHaveBeenCalledTimes(3);
    expect(failing).toHaveBeenCalledWith(expect.any(String), "release");
    expect(toastWarning).toHaveBeenCalledWith(
      "designEditor.import.warningsToast",
      { description: "designEditor.import.pasteImagesUnsaved" },
    );
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("could not confirm an upload was kept"),
      expect.any(Error),
    );
  });

  it("keeps the uploads when a release confirms on a retry", async () => {
    const settle = vi
      .fn<(key: string, mode: "release" | "delete") => Promise<void>>()
      .mockRejectedValueOnce(new Error("not yet"))
      .mockResolvedValue(undefined);
    const { args } = setup(insideScreen, {
      mirrorImage: async () => "https://files.test/a.png",
      settleImage: settle,
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(settle).toHaveBeenCalledTimes(2);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("does not delete hosted uploads when an error comes after the layers were inserted", async () => {
    const { args, settleImage } = setup(insideScreen, {
      mirrorImage: async () => "https://files.test/a.png",
    });
    args.showPastedImagesNotice = () => {
      throw new Error("ui failed after insert");
    };
    await runImportDesignToolPasteIntoDesign(args, {
      ...withImage(),
      unresolvedImages: 1,
    });
    expect(settleImage).not.toHaveBeenCalledWith(expect.anything(), "delete");
  });

  it("deletes the hosted uploads when the layers cannot be inserted", async () => {
    const { args, settleImage } = setup(insideScreen, {
      mirrorImage: async () => "https://files.test/a.png",
      insertPasteLayers: () => false,
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(settleImage).toHaveBeenCalledWith(
      expect.stringMatching(/^images:[^:]+:0$/),
      "delete",
    );
    expect(settleImage).not.toHaveBeenCalledWith(expect.anything(), "release");
  });

  it("keeps upload receipts out of the screen batch and releases them after it commits", async () => {
    callAction.mockResolvedValueOnce({ files: [{ id: "f1" }] });
    const keys: string[] = [];
    const { args, settleImage } = setup(noTarget, {
      mirrorImage: async (_url, key) => {
        keys.push(key);
        return "https://files.test/a.png";
      },
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    const [, body] = callAction.mock.calls[0] ?? [];
    const batchId = (body as { clientImportBatchId: string })
      .clientImportBatchId;
    // A receipt under the batch id would be swept up by the server's commit,
    // even a pending or unused one.
    expect(keys[0]?.startsWith(`${batchId}:`)).toBe(false);
    expect(settleImage).toHaveBeenCalledWith(keys[0], "release");
    expect(settleImage).not.toHaveBeenCalledWith(keys[0], "delete");
  });

  it("clears the receipt of an upload that failed", async () => {
    const { args, settleImage } = setup(insideScreen, {
      mirrorImage: async () => {
        throw new Error("request timed out");
      },
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(settleImage).toHaveBeenCalledWith(
      expect.stringMatching(/^images:[^:]+:0$/),
      "delete",
    );
  });

  it("plans the paste against the scene captured before the uploads", async () => {
    const order: string[] = [];
    const { args } = setup(insideScreen, {
      resolvePasteScene: () => {
        order.push("scene");
        return insideScreen;
      },
      mirrorImage: async () => {
        order.push("upload");
        return "https://files.test/a.png";
      },
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(order).toEqual(["scene", "upload"]);
  });

  it("still inserts when hosting fails and logs the reason", async () => {
    const { args, insertPasteLayers } = setup(insideScreen, {
      mirrorImage: async () => {
        throw new Error("storage offline");
      },
    });
    await runImportDesignToolPasteIntoDesign(args, withImage());
    expect(insertPasteLayers).toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalledWith(
      "designEditor.import.warningsToast",
      { description: "designEditor.import.pasteImagesLinked" },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Wonder"),
      expect.arrayContaining(["storage offline"]),
    );
  });
});

describe("a design-tool paste of loose layers onto the board", () => {
  it("inserts a board plan into the board file", async () => {
    const { args, insertPasteLayers } = setup(onBoard);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({
        layers: [
          {
            ...layer("Loose"),
            content:
              '<!DOCTYPE html><html><head></head><body><div><div data-agent-native-layer-name="Loose"></div></div></body></html>',
            wrapsLooseNode: true,
          },
        ],
      }),
    );
    expect(callAction).not.toHaveBeenCalled();
    expect(insertPasteLayers).toHaveBeenCalledWith(
      "board",
      null,
      expect.any(Array),
    );
  });
});

describe("a design-tool paste with no screen to land in", () => {
  it("creates every frame in one batch and focuses the first", async () => {
    callAction.mockResolvedValueOnce({ files: [{ id: "f1" }, { id: "f2" }] });
    const { args, navigate } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: [layer("One"), layer("Two")] }),
    );
    expect(callAction).toHaveBeenCalledTimes(1);
    const [name, body] = callAction.mock.calls[0] ?? [];
    expect(name).toBe("import-design-source");
    expect(body).toMatchObject({
      designId: "design-1",
      sourceType: "fig-frame",
      clientImportFinalBatch: true,
      frames: [
        { frameTitle: "One", frameWidth: 100, frameHeight: 80 },
        { frameTitle: "Two" },
      ],
    });
    const frames = (body as { frames: Array<{ clientImportId: string }> })
      .frames;
    const batchId = (body as { clientImportBatchId: string })
      .clientImportBatchId;
    expect(frames.map((frame) => frame.clientImportId)).toEqual([
      `${batchId}:0`,
      `${batchId}:1`,
    ]);
    expect(navigate).toHaveBeenCalledWith(
      "/design/design-1?editorView=overview&screen=f1",
    );
  });

  it("sends a server-safe filename and keeps the real title", async () => {
    callAction.mockResolvedValueOnce({ files: [{ id: "f1" }] });
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({
        layers: [layer("Context=Fill, Tab=Custom / Mode=Hex")],
      }),
    );
    const [, body] = callAction.mock.calls[0] ?? [];
    expect(
      (body as { frames: Array<Record<string, unknown>> }).frames[0],
    ).toMatchObject({
      originalName: "context-fill-tab-custom-mode-hex",
      frameTitle: "Context=Fill, Tab=Custom / Mode=Hex",
    });
  });

  it("sends the planned canvas position with each frame", async () => {
    callAction.mockResolvedValueOnce({ files: [{ id: "f1" }] });
    const { args } = setup({
      container: null,
      viewport: { x: 0, y: 0, width: 4000, height: 3000 },
      screens: [{ fileId: "other", x: 0, y: 0, width: 10, height: 10 }],
    });
    await runImportDesignToolPasteIntoDesign(args, paste());
    const [, body] = callAction.mock.calls[0] ?? [];
    expect(
      (body as { frames: Array<{ frameX?: number; frameY?: number }> })
        .frames[0],
    ).toMatchObject({ frameX: expect.any(Number), frameY: expect.any(Number) });
  });

  it("splits more than 32 frames into batches that share one id", async () => {
    callAction.mockImplementation(async (_name: string, body: unknown) => ({
      files: (body as { frames: unknown[] }).frames.map((_, i) => ({
        id: `f${i}`,
      })),
    }));
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: Array.from({ length: 40 }, (_, i) => layer(`L${i}`)) }),
    );
    const bodies = callAction.mock.calls.map(
      ([, body]) =>
        body as {
          clientImportBatchId: string;
          clientImportFinalBatch: boolean;
          frames: unknown[];
        },
    );
    expect(bodies.map((body) => body.frames.length)).toEqual([32, 8]);
    expect(bodies.map((body) => body.clientImportFinalBatch)).toEqual([
      false,
      true,
    ]);
    expect(new Set(bodies.map((body) => body.clientImportBatchId)).size).toBe(
      1,
    );
  });

  it("removes the screens an earlier batch created when a later one fails", async () => {
    callAction
      .mockResolvedValueOnce({ files: [{ id: "f1" }] })
      .mockResolvedValueOnce({ error: "too large" })
      .mockResolvedValueOnce({ deletedFileIds: ["f1"] });
    const { args, navigate } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: Array.from({ length: 40 }, (_, i) => layer(`L${i}`)) }),
    );
    expect(callAction.mock.calls[2]?.[1]).toMatchObject({ abort: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.wonderPasteFailed",
      { description: "common.genericError" },
    );
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("wonder import failed"),
      expect.objectContaining({ message: "too large" }),
    );
  });

  it("packs frames under the request byte limit, not just the frame count", async () => {
    callAction.mockImplementation(async (_name: string, body: unknown) => ({
      files: (body as { frames: unknown[] }).frames.map((_, i) => ({
        id: `f${i}`,
      })),
    }));
    const big = (title: string) => ({
      ...layer(title),
      content: `<!DOCTYPE html><html><body>${"x".repeat(1_700_000)}</body></html>`,
    });
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: [big("A"), big("B"), big("C")] }),
    );
    const batches = callAction.mock.calls.map(
      ([, body]) =>
        (body as { frames: Array<{ clientImportId: string }> }).frames.length,
    );
    expect(batches).toEqual([1, 1, 1]);
    const finals = callAction.mock.calls.map(
      ([, body]) =>
        (body as { clientImportFinalBatch: boolean }).clientImportFinalBatch,
    );
    expect(finals).toEqual([false, false, true]);
  });

  it("sizes batches by the JSON that is sent, where escaping doubles a frame", async () => {
    callAction.mockImplementation(async (_name: string, body: unknown) => ({
      files: (body as { frames: unknown[] }).frames.map((_, i) => ({
        id: `f${i}`,
      })),
    }));
    // 1.1 MB of backslashes is 2.2 MB once JSON escapes it: two of these would
    // fit a raw-size estimate under 3 MiB but not the real request.
    const slashes = (title: string) => ({
      ...layer(title),
      content: `<!DOCTYPE html><html><body>${"\\".repeat(1_100_000)}</body></html>`,
    });
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: [slashes("A"), slashes("B")] }),
    );
    expect(
      callAction.mock.calls.map(
        ([, body]) => (body as { frames: unknown[] }).frames.length,
      ),
    ).toEqual([1, 1]);
  });

  it("bounds a frame title taken from the copy", async () => {
    callAction.mockResolvedValueOnce({ files: [{ id: "f1" }] });
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: [layer("T".repeat(5000))] }),
    );
    const [, body] = callAction.mock.calls[0] ?? [];
    const title = (body as { frames: Array<{ frameTitle: string }> }).frames[0]
      ?.frameTitle;
    expect(title).toHaveLength(200);
  });

  it("keeps hosted uploads when screens may remain after a failed cleanup", async () => {
    callAction
      .mockRejectedValueOnce(new Error("import failed"))
      .mockRejectedValueOnce(new Error("abort failed"));
    const { args, settleImage } = setup(noTarget, {
      mirrorImage: async () => "https://files.test/a.png",
    });
    await runImportDesignToolPasteIntoDesign(args, {
      ...paste(),
      layers: [
        {
          ...layer("Card"),
          content: `<!DOCTYPE html><html><body><div style="background-image:url(&quot;https://cdn.example.test/a.png&quot;)"></div></body></html>`,
        },
      ],
      remoteImages: ["https://cdn.example.test/a.png"],
    });
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.wonderPasteFailed",
      { description: "designEditor.import.pastePartialImport" },
    );
    expect(settleImage).not.toHaveBeenCalledWith(expect.anything(), "delete");
    // Screens may point at the upload, so it is kept rather than left to expire.
    expect(settleImage).toHaveBeenCalledWith(
      expect.stringMatching(/^images:[^:]+:0$/),
      "release",
    );
  });

  it("refuses a frame that is too big once JSON escaping is counted", async () => {
    // 1.6M backslashes pass the 2 MiB HTML check and are 3.2 MB on the wire.
    const heavy = {
      ...layer("Heavy"),
      content: `<!DOCTYPE html><html><body>${"\\".repeat(1_600_000)}</body></html>`,
    };
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(args, paste({ layers: [heavy] }));
    expect(callAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.wonderPasteFailed",
      { description: "common.genericError" },
    );
  });

  it("tells the user screens may remain when clearing the batch also fails", async () => {
    callAction
      .mockResolvedValueOnce({ files: [{ id: "f1" }] })
      .mockRejectedValueOnce(new Error("second batch failed"))
      .mockRejectedValueOnce(new Error("abort failed"));
    const big = (title: string) => ({
      ...layer(title),
      content: `<!DOCTYPE html><html><body>${"x".repeat(1_700_000)}</body></html>`,
    });
    const { args, navigate } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: [big("A"), big("B")] }),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.wonderPasteFailed",
      { description: "designEditor.import.pastePartialImport" },
    );
  });

  it("keeps the overview route when no created file has an id", async () => {
    callAction.mockResolvedValue({ files: [] });
    const { args, navigate } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(args, paste());
    expect(navigate).toHaveBeenCalledWith(
      "/design/design-1?editorView=overview",
    );
  });

  it("hands unloaded images to the notice with the screens it created", async () => {
    callAction.mockResolvedValueOnce({ files: [{ id: "f1" }, { id: "f2" }] });
    const { args, showPastedImagesNotice } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({
        tool: "figma",
        layers: [layer("One"), layer("Two")],
        unresolvedImages: 2,
      }),
    );
    expect(showPastedImagesNotice).toHaveBeenCalledWith({
      count: 2,
      fileIds: ["f1", "f2"],
    });
  });

  it("asks the server to clear the batch even when no response arrived", async () => {
    callAction
      .mockRejectedValueOnce(new Error("network dropped"))
      .mockResolvedValueOnce({ deletedFileIds: [] });
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(args, paste());
    expect(callAction).toHaveBeenCalledTimes(2);
    expect(callAction.mock.calls[1]?.[1]).toMatchObject({ abort: true });
  });

  it("refuses a frame the server would reject before creating anything", async () => {
    const { args } = setup(noTarget);
    const huge = {
      ...layer("Huge"),
      content: `<!DOCTYPE html><html><body>${"x".repeat(2 * 1024 * 1024)}</body></html>`,
    };
    await runImportDesignToolPasteIntoDesign(
      args,
      paste({ layers: [layer("Small"), huge] }),
    );
    expect(callAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.wonderPasteFailed",
      { description: "common.genericError" },
    );
  });

  it("names the failing tool when screens cannot be created", async () => {
    callAction
      .mockResolvedValueOnce({ error: "name_taken" })
      .mockResolvedValueOnce({ deletedFileIds: [] });
    const { args } = setup(noTarget);
    await runImportDesignToolPasteIntoDesign(args, paste({ tool: "paper" }));
    expect(toastError).toHaveBeenCalledWith(
      "designEditor.import.errors.paperPasteFailed",
      { description: "common.genericError" },
    );
  });
});

describe("a design-tool paste that cannot be applied", () => {
  it("does nothing without edit access", async () => {
    const { args, insertPasteLayers } = setup(insideScreen, {
      canEditDesign: false,
    });
    await runImportDesignToolPasteIntoDesign(args, paste());
    expect(insertPasteLayers).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });
});

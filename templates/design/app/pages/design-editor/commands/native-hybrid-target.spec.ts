// @vitest-environment jsdom
import { callAction } from "@agent-native/core/client/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GRAIN_GRADIENT_EFFECT } from "../../../../shared/native-effect-presets";
import { writeEffectsToHtml } from "../../../../shared/native-effects";
import { sourceContentHash } from "../../../../shared/source-workspace";
import { resolveNativeHybridTarget } from "./native-hybrid-target";

vi.mock("@agent-native/core/client/hooks", () => ({ callAction: vi.fn() }));

function source(native: boolean) {
  if (!native) return "<main></main>";
  return writeEffectsToHtml('<main data-agent-native-node-id="card"></main>', {
    schemaVersion: 2,
    definitions: [GRAIN_GRADIENT_EFFECT],
    instances: [
      {
        id: "instance-1",
        nodeId: "card",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
        placement: "fill",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 77,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: true, time: 0 },
      },
    ],
  });
}

beforeEach(() => {
  vi.mocked(callAction).mockImplementation(async (_name, args) => ({
    designId: "design-1",
    fileId: (args as { fileId: string }).fileId,
    content: source(true),
    versionHash: sourceContentHash(source(true)),
  }));
});
afterEach(() => document.body.replaceChildren());
import type { RenderPngBlobArgs } from "./render-png-blob";

function scene(native: boolean, fileId = "screen-a") {
  const doc = document.implementation.createHTMLDocument("scene");
  if (native) {
    const manifest = doc.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    doc.body.append(manifest);
  }
  const iframe = document.createElement("iframe");
  Object.defineProperties(iframe, {
    clientWidth: { configurable: true, value: 1440 },
    clientHeight: { configurable: true, value: 1024 },
    contentDocument: { configurable: true, value: doc },
    contentWindow: {
      configurable: true,
      value: {
        __agentNativeSourceProvenance: {
          versionHash: sourceContentHash(source(native)),
        },
      },
    },
  });
  document.body.appendChild(iframe);
  return {
    doc,
    iframe,
    cropSelection: null,
    sourceFileId: fileId,
  };
}

function input(
  resolvePngCaptureTarget: ReturnType<typeof vi.fn>,
  selectedScreenIds: string[] = ["screen-a"],
) {
  return {
    designId: "design-1",
    canvasFrameGeometryById: {},
    overviewScreens: [],
    resolvePngCaptureTarget:
      resolvePngCaptureTarget as unknown as RenderPngBlobArgs["resolvePngCaptureTarget"],
    selectedScreenIds,
    viewMode: "overview" as const,
    scope: "screens" as const,
  };
}

describe("native hybrid export selection", () => {
  it("keeps a selected board frame's exact crop for hybrid SVG and PDF", async () => {
    const native = scene(true, "board-file");
    const node = native.doc.createElement("div");
    node.id = "selected";
    node.setAttribute("data-agent-native-node-id", "frame-1");
    node.getBoundingClientRect = () =>
      ({ left: 4314, top: 2069, width: 1162, height: 887 }) as DOMRect;
    native.doc.body.append(node);
    const target = await resolveNativeHybridTarget({
      ...input(
        vi.fn().mockResolvedValue({
          ...native,
          cropSelection: { tagName: "DIV", selector: "#selected" },
        }),
      ),
      boardFileId: "board-file",
      scope: "element",
    });
    expect(target).toMatchObject({
      fileId: "board-file",
      viewport: { width: 1162, height: 887 },
      crop: { x: 4314, y: 2069, nodeId: "frame-1" },
    });
  });
  it("uses the one selected native source and its exact viewport", async () => {
    const resolve = vi.fn().mockResolvedValue(scene(true));
    await expect(resolveNativeHybridTarget(input(resolve))).resolves.toEqual({
      designId: "design-1",
      fileId: "screen-a",
      viewport: { width: 1440, height: 1024 },
      pixelRatio: 1,
      expectedVersionHash: sourceContentHash(source(true)),
      assertStillViewed: expect.any(Function),
    });
    expect(resolve).toHaveBeenCalledWith("screens", "screen-a");
  });

  it("finds a native second screen and rejects mixed multi-screen composition", async () => {
    vi.mocked(callAction).mockImplementation(async (_name, args) => {
      const fileId = (args as { fileId: string }).fileId;
      const content = source(fileId === "screen-b");
      return {
        designId: "design-1",
        fileId,
        content,
        versionHash: sourceContentHash(content),
      };
    });
    const resolve = vi.fn(async (_scope, screenId: string) =>
      scene(screenId === "screen-b", screenId),
    );
    await expect(
      resolveNativeHybridTarget(input(resolve, ["screen-a", "screen-b"])),
    ).rejects.toThrow(/one complete native Design scene/);
  });

  it("returns null for a non-native scene so the existing vector export can continue", async () => {
    vi.mocked(callAction).mockImplementation(async (_name, args) => ({
      designId: "design-1",
      fileId: (args as { fileId: string }).fileId,
      content: source(false),
      versionHash: sourceContentHash(source(false)),
    }));
    await expect(
      resolveNativeHybridTarget(input(vi.fn().mockResolvedValue(scene(false)))),
    ).resolves.toBeNull();
  });

  it("refuses legacy export when an unsaved native scene is still viewed", async () => {
    vi.mocked(callAction).mockImplementation(async (_name, args) => ({
      designId: "design-1",
      fileId: (args as { fileId: string }).fileId,
      content: source(false),
      versionHash: sourceContentHash(source(false)),
    }));
    await expect(
      resolveNativeHybridTarget(input(vi.fn().mockResolvedValue(scene(true)))),
    ).rejects.toMatchObject({ code: "source-stale" });
  });

  it("refuses a saved native scene when the viewed preview has not loaded it", async () => {
    await expect(
      resolveNativeHybridTarget(input(vi.fn().mockResolvedValue(scene(false)))),
    ).rejects.toMatchObject({ code: "scene-unreadable" });
  });

  it("refuses a newer saved version and a later in-place preview edit", async () => {
    const viewed = scene(true);
    vi.mocked(callAction).mockImplementation(async (_name, args) => ({
      designId: "design-1",
      fileId: (args as { fileId: string }).fileId,
      content: source(true) + " ",
      versionHash: sourceContentHash(source(true) + " "),
    }));
    await expect(
      resolveNativeHybridTarget(input(vi.fn().mockResolvedValue(viewed))),
    ).rejects.toMatchObject({ code: "source-stale" });

    vi.mocked(callAction).mockImplementation(async (_name, args) => ({
      designId: "design-1",
      fileId: (args as { fileId: string }).fileId,
      content: source(true),
      versionHash: sourceContentHash(source(true)),
    }));
    const target = await resolveNativeHybridTarget(
      input(vi.fn().mockResolvedValue(viewed)),
    );
    (
      viewed.iframe.contentWindow as Window & {
        __agentNativeSourceProvenance: { versionHash: string };
      }
    ).__agentNativeSourceProvenance.versionHash = "17:changed";
    expect(target?.assertStillViewed).toThrowError(
      expect.objectContaining({ code: "source-stale" }),
    );
  });

  it("rejects rotated native screens before claiming a complete vector export", async () => {
    const args = input(vi.fn().mockResolvedValue(scene(true)));
    args.canvasFrameGeometryById = {
      "screen-a": { rotation: 12 },
    };
    await expect(resolveNativeHybridTarget(args)).rejects.toThrow(
      /rotated frames/,
    );
  });
});

import { rm } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSourceWorkspace: vi.fn(),
  loadSelectedSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
  readAppState: vi.fn(),
  localQaEnabled: vi.fn(),
  requestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.requestUserEmail,
}));
vi.mock("../server/lib/local-figma-qa-upload.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/local-figma-qa-upload.js")
  >()),
  isLocalFigmaQaUploadEnabled: mocks.localQaEnabled,
}));
vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  loadSelectedSourceWorkspaceFile: mocks.loadSelectedSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
  SourceWorkspaceEditConflictError: class extends Error {},
}));

import {
  createLocalFigmaQaUploadProvider,
  localFigmaQaAssetPath,
} from "../server/lib/local-figma-qa-upload.js";
import {
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
} from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
  updateNativeInstanceInHtml,
} from "../shared/native-effects.js";
import action from "./prepare-native-scene-export.js";

const stored =
  '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Old SQL text</div></body></html>';
const applied = applyNativeEffectToHtml(
  '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Live scene</div></body></html>',
  {
    nodeId: "hero",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  },
);
const screen = {
  id: "screen-1",
  designId: "design-1",
  filename: "index.html",
  fileType: "html",
  createdAt: null,
  updatedAt: null,
};

describe("prepare-native-scene-export", () => {
  it("accepts bounded query-string dimensions from the GET action transport", () => {
    expect(
      action.schema.parse({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: "1280",
        viewportHeight: "800",
        pixelRatio: 1,
      }),
    ).toMatchObject({
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    for (const pixelRatio of ["", 0, 4.1, "Infinity", null, true])
      expect(
        action.schema.safeParse({
          designId: "design-1",
          fileId: "screen-1",
          viewportWidth: "1280",
          viewportHeight: "800",
          pixelRatio,
        }).success,
      ).toBe(false);
    expect(
      action.schema.safeParse({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: "2048",
        viewportHeight: "1024",
        pixelRatio: "4",
      }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: "4096",
        viewportHeight: "4096",
        pixelRatio: 1,
      }).success,
    ).toBe(false);
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      files: [screen],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...screen,
      content: stored,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html,
      versionHash: "live-version-2",
      source: "collab",
      language: "html",
    });
    mocks.readAppState.mockResolvedValue(null);
    mocks.localQaEnabled.mockReturnValue(false);
    mocks.requestUserEmail.mockReturnValue("owner@example.test");
  });

  it("prepares the selected live Design source with trusted runtime and source version", async () => {
    expect(applied.errors).toEqual([]);
    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.html).toContain("Live scene");
    expect(result.html).not.toContain("Old SQL text");
    expect(result.html).toContain("Content-Security-Policy");
    expect(result.html).toContain("data-agent-native-native-shader-runtime");
    expect(result.approvedDefinitionHashes).toEqual([
      await hashEffectDefinition(GRAIN_GRADIENT_EFFECT),
    ]);
    expect(result.approvedDefinitionHashes).not.toContain(
      await hashEffectDefinition(HALFTONE_EFFECT),
    );
    expect(result.localQaSinkEnabled).toBe(false);
    expect(result.viewport).toEqual({ width: 1280, height: 800 });
    expect(result.initialPixelRatio).toBe(1);
    expect(result.html).toContain(
      'data-agent-native-export-initial-pixel-ratio="1"',
    );
    expect(result.instanceTargets).toEqual([
      expect.objectContaining({
        nodeId: "hero",
        instanceId: expect.any(String),
      }),
    ]);
    expect(result.sourceVersions).toEqual([
      {
        fileId: "screen-1",
        filename: "index.html",
        versionHash: "live-version-2",
      },
    ]);
    expect(mocks.resolveSourceWorkspace).toHaveBeenCalledWith("design-1", {
      includeContent: false,
      includeBoard: true,
    });
    expect(mocks.readLiveSourceFile).toHaveBeenCalledWith({
      ...screen,
      content: stored,
    });
  });

  it("does not treat a modified builtin with the same ID and version as trusted", async () => {
    const modified = {
      ...GRAIN_GRADIENT_EFFECT,
      passes: [
        {
          ...GRAIN_GRADIENT_EFFECT.passes[0],
          wgsl: `${GRAIN_GRADIENT_EFFECT.passes[0].wgsl}\n// modified`,
        },
      ],
    };
    const changed = applyNativeEffectToHtml(
      '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Changed shader</div></body></html>',
      { nodeId: "hero", definition: modified, placement: "fill" },
    );
    expect(changed.errors).toEqual([]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: changed.html,
      versionHash: "live-modified-builtin",
      source: "collab",
      language: "html",
    });
    await expect(
      action.run({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: 1280,
        viewportHeight: 800,
        pixelRatio: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_authorization_unapproved",
      statusCode: 422,
    });
  });

  it("relays only a custom definition explicitly approved for this viewer and scene", async () => {
    const custom = { ...GRAIN_GRADIENT_EFFECT, id: "an-native-owner-custom" };
    const authored = applyNativeEffectToHtml(
      '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Custom shader</div></body></html>',
      { nodeId: "hero", definition: custom, placement: "fill" },
    );
    expect(authored.errors).toEqual([]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: authored.html,
      versionHash: "live-custom",
      source: "collab",
      language: "html",
    });
    const customHash = await hashEffectDefinition(custom);
    const unrelatedHash = await hashEffectDefinition(HALFTONE_EFFECT);
    mocks.readAppState.mockResolvedValue({
      schemaVersion: 1,
      hashes: [unrelatedHash, customHash],
    });
    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.approvedDefinitionHashes).toEqual([customHash]);
    expect(result.html).toContain(customHash);
    expect(result.html).not.toContain(unrelatedHash);
  });

  it("rejects an unapproved custom definition", async () => {
    const custom = {
      ...GRAIN_GRADIENT_EFFECT,
      id: "an-native-owner-unapproved",
    };
    const authored = applyNativeEffectToHtml(
      '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Custom shader</div></body></html>',
      { nodeId: "hero", definition: custom, placement: "fill" },
    );
    expect(authored.errors).toEqual([]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: authored.html,
      versionHash: "live-unapproved-custom",
      source: "collab",
      language: "html",
    });
    await expect(
      action.run({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: 1280,
        viewportHeight: 800,
        pixelRatio: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_authorization_unapproved",
      statusCode: 422,
    });
  });

  it("packages a canonical native input asset in one inert registry without changing its source URL", async () => {
    const textured = applyNativeEffectToHtml(
      '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Source image</div></body></html>',
      {
        nodeId: "hero",
        definition: HALFTONE_EFFECT,
        placement: "layer",
        bindings: {
          source: { kind: "asset", url: "/shaders/input-alpha-mask.png" },
        },
      },
    );
    expect(textured.errors).toEqual([]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: textured.html,
      versionHash: "live-with-image",
      source: "collab",
      language: "html",
    });
    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(
      result.html.match(/<script[^>]*data-agent-native-export-assets/g),
    ).toHaveLength(1);
    expect(result.html).toContain('"path":"/shaders/input-alpha-mask.png"');
    expect(
      parseEffectsFromHtml(result.html).document?.instances[0]?.bindings
        ?.source,
    ).toEqual({
      kind: "asset",
      url: "/shaders/input-alpha-mask.png",
    });
  });

  it("packages the actual owner-scoped QA upload URL through the selected-scene action", async () => {
    mocks.localQaEnabled.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_DESIGN_QA_LOCAL_UPLOADS", "true");
    const provider = createLocalFigmaQaUploadProvider({ enabled: () => true });
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 1,
    ]);
    const uploaded = await provider.upload({
      data: bytes,
      mimeType: "image/png",
      ownerEmail: "owner@example.test",
    });
    const filepath = localFigmaQaAssetPath("owner@example.test", uploaded.id!)!;
    try {
      const textured = applyNativeEffectToHtml(
        '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Source</div></body></html>',
        {
          nodeId: "hero",
          definition: HALFTONE_EFFECT,
          placement: "layer",
          bindings: { source: { kind: "asset", url: uploaded.url } },
        },
      );
      expect(textured.errors).toEqual([]);
      mocks.readLiveSourceFile.mockResolvedValue({
        content: textured.html,
        versionHash: "live-qa-upload",
        source: "collab",
        language: "html",
      });
      const result = await action.run({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: 1280,
        viewportHeight: 800,
        pixelRatio: 1,
      });
      expect(
        result.html.match(/<script[^>]*data-agent-native-export-assets/g),
      ).toHaveLength(1);
      expect(result.html).toContain(`"path":"${uploaded.url}"`);
      expect(result.html).toContain(Buffer.from(bytes).toString("base64"));
      expect(result.sourceVersions[0]?.versionHash).toBe("live-qa-upload");
      expect(mocks.requestUserEmail).toHaveBeenCalled();
    } finally {
      await rm(filepath, { force: true });
      vi.unstubAllEnvs();
    }
  });

  it("returns a typed action failure for an unsupported native input MIME", async () => {
    const textured = applyNativeEffectToHtml(
      '<!doctype html><html><head></head><body><div data-agent-native-node-id="hero">Source image</div></body></html>',
      {
        nodeId: "hero",
        definition: HALFTONE_EFFECT,
        placement: "layer",
        bindings: {
          source: { kind: "asset", url: "/shaders/gate-image.svg" },
        },
      },
    );
    expect(textured.errors).toEqual([]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: textured.html,
      versionHash: "live-with-svg",
      source: "collab",
      language: "html",
    });
    await expect(
      action.run({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: 1280,
        viewportHeight: 800,
        pixelRatio: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_asset_unsupported",
      statusCode: 422,
    });
  });

  it("advertises the isolated local QA sink only when the server enables it", async () => {
    mocks.localQaEnabled.mockReturnValue(true);
    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.localQaSinkEnabled).toBe(true);
  });

  it("keeps a valid disabled effect in the package without waiting for a runtime mount", async () => {
    const instanceId = parseEffectsFromHtml(applied.html).document?.instances[0]
      ?.id;
    expect(instanceId).toBeTruthy();
    const disabled = updateNativeInstanceInHtml(applied.html, instanceId!, {
      enabled: false,
    });
    expect(disabled.errors).toEqual([]);
    mocks.readLiveSourceFile.mockResolvedValue({
      content: disabled.html,
      versionHash: "live-disabled",
      source: "collab",
      language: "html",
    });

    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.instanceTargets).toEqual([]);
    expect(result.approvedDefinitionHashes).toEqual([]);
    expect(parseEffectsFromHtml(result.html).document?.instances).toEqual([
      expect.objectContaining({ id: instanceId, enabled: false }),
    ]);
  });

  it("does not package an unrelated live board when exporting a selected screen", async () => {
    const board = {
      ...screen,
      id: "board-1",
      filename: "__board__.html",
    };
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      files: [screen, board],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockImplementation(async (file) => ({
      ...file,
      content: file.id === "screen-1" ? stored : "<html><body></body></html>",
    }));
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content:
        file.id === "screen-1"
          ? applied.html
          : '<html><body><div data-agent-native-node-id="board-node">Artwork</div></body></html>',
      versionHash: `live-${file.id}`,
      source: "collab",
      language: "html",
    }));

    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.html).toContain("Live scene");
    expect(result.html).not.toContain("Artwork");
    expect(result.sourceVersions).toHaveLength(1);
    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(1);
  });

  it("exports the selected board file as the authoritative scene", async () => {
    const board = { ...screen, id: "board-1", filename: "__board__.html" };
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      files: [screen, board],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...board,
      content: stored,
    });
    const result = await action.run({
      designId: "design-1",
      fileId: "board-1",
      viewportWidth: 490,
      viewportHeight: 350,
      pixelRatio: 1,
    });
    expect(result.fileId).toBe("board-1");
    expect(result.viewport).toEqual({ width: 490, height: 350 });
    expect(result.sourceVersions).toEqual([
      {
        fileId: "board-1",
        filename: "__board__.html",
        versionHash: "live-version-2",
      },
    ]);
    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(1);
  });

  it("includes live project CSS and its exact version without unrelated HTML", async () => {
    const css = {
      ...screen,
      id: "style-1",
      filename: "scene.css",
      fileType: "css",
    };
    const otherScreen = { ...screen, id: "screen-2", filename: "other.html" };
    mocks.resolveSourceWorkspace.mockResolvedValue({
      designId: "design-1",
      sourceType: "inline",
      files: [screen, css, otherScreen],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockImplementation(async (file) => ({
      ...file,
      content: file.fileType === "css" ? ".scene{display:block}" : stored,
    }));
    mocks.readLiveSourceFile.mockImplementation(async (file) => ({
      content: file.fileType === "css" ? ".scene{display:grid}" : applied.html,
      versionHash: `live-${file.id}`,
      source: "collab",
      language: file.fileType,
    }));

    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.html).toContain(".scene{display:grid}");
    expect(result.html).not.toContain(".scene{display:block}");
    expect(result.sourceVersions.map((entry) => entry.fileId)).toEqual([
      "screen-1",
      "style-1",
    ]);
    expect(mocks.readLiveSourceFile).toHaveBeenCalledTimes(2);
  });

  it("compiles the known Tailwind v4 browser tag before external-asset rejection", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html
        .replace(
          "</head>",
          '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script></head>',
        )
        .replace(
          'data-agent-native-node-id="hero"',
          'data-agent-native-node-id="hero" class="hover:bg-red-500"',
        ),
      versionHash: "live-tailwind",
      source: "collab",
      language: "html",
    });
    const result = await action.run({
      designId: "design-1",
      fileId: "screen-1",
      viewportWidth: 1280,
      viewportHeight: 800,
      pixelRatio: 1,
    });
    expect(result.html).toContain(".hover\\:bg-red-500");
    expect(result.html).not.toContain("@tailwindcss/browser@4");
  });

  it("still rejects an external image even if its URL matches the Tailwind CDN", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html.replace(
        "</body>",
        '<img src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></body>',
      ),
      versionHash: "live-external-image",
      source: "collab",
      language: "html",
    });
    await expect(
      action.run({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: 1280,
        viewportHeight: 800,
        pixelRatio: 1,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_export_asset_unsupported",
    });
  });

  it("rejects authored JavaScript in the selected live scene", async () => {
    mocks.readLiveSourceFile.mockResolvedValue({
      content: applied.html.replace(
        "</body>",
        "<script>document.body.textContent = 'changed'</script></body>",
      ),
      versionHash: "live-scripted",
      source: "collab",
      language: "html",
    });

    await expect(
      action.run({
        designId: "design-1",
        fileId: "screen-1",
        viewportWidth: 1280,
        viewportHeight: 800,
        pixelRatio: 1,
      }),
    ).rejects.toMatchObject({ errorCode: "native_export_script_unsupported" });
  });
});

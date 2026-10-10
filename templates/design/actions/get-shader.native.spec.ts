import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  resolveSourceWorkspace: vi.fn(),
  loadSelectedSourceWorkspaceFile: vi.fn(),
  readLiveSourceFile: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("../server/source-workspace.js", () => ({
  resolveSourceWorkspace: mocks.resolveSourceWorkspace,
  loadSelectedSourceWorkspaceFile: mocks.loadSelectedSourceWorkspaceFile,
  readLiveSourceFile: mocks.readLiveSourceFile,
}));

vi.mock(
  "../../../packages/core/src/server/framework-request-handler.js",
  () => ({
    getH3App: (app: unknown) => app,
  }),
);

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  getMethod: (event: { _method?: string }) => event._method ?? "GET",
  getQuery: (event: { _query?: Record<string, unknown> }) => event._query ?? {},
  getHeader: (event: { _headers?: Record<string, string> }, name: string) =>
    event._headers?.[name.toLowerCase()],
  getRequestHeader: (
    event: { _headers?: Record<string, string> },
    name: string,
  ) => event._headers?.[name.toLowerCase()],
  getRequestURL: (event: { req?: { url?: string } }) =>
    new URL(
      event.req?.url ?? "http://app.test/_agent-native/actions/get-shader",
    ),
  setResponseStatus: (event: { _status?: number }, status: number) => {
    event._status = status;
  },
  setResponseHeader: (
    event: { _responseHeaders?: Record<string, string> },
    name: string,
    value: string,
  ) => {
    event._responseHeaders = {
      ...(event._responseHeaders ?? {}),
      [name.toLowerCase()]: value,
    };
  },
}));

import { editNativeEffectHtml } from "../shared/native-effect-edits.js";
import {
  GRAIN_GRADIENT_EFFECT,
  NATIVE_EFFECT_PRESETS,
} from "../shared/native-effect-presets.js";
import { applyNativeEffectToHtml } from "../shared/native-effects.js";
import action from "./get-shader.js";

describe("get-shader native-v2", () => {
  beforeEach(() => mocks.readAppState.mockResolvedValue(null));
  it("marks legacy descriptors read-only without advertising retired presets", async () => {
    const result = await action.run({ format: "legacy" });
    expect(result).toMatchObject({
      format: "legacy",
      savedDescriptorStatus: "read-only",
      hint: expect.stringContaining("an-native-gradient-field version 1"),
      instructions: expect.stringContaining("edit-native-shader"),
    });
    expect(result).not.toHaveProperty("availablePresets");
    expect(result).not.toHaveProperty("presetNames");
    expect(result).not.toHaveProperty("presetSummary");
    expect(JSON.stringify(result)).not.toContain("PaperTexture");
    expect(JSON.stringify(result)).not.toContain("imported shader components");
  });

  it("discovers versioned definitions and named presets without reading a design", async () => {
    const result = await action.run({ format: "native-v2" });
    expect(result).toMatchObject({
      manifestState: "not-requested",
      document: null,
    });
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: GRAIN_GRADIENT_EFFECT.id, version: 1 }),
        expect.objectContaining({ id: GRAIN_GRADIENT_EFFECT.id, version: 2 }),
      ]),
    );
    expect(result.definitions).toHaveLength(232);
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-m-cell-dissolve",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-m-iris-aperture",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-m-page-fold",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-m-brush-liquify",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-m-watercolor-pooling",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-m-interference-edge-fringe",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-n-arc-path",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-n-rational-circle-canopy",
          version: 2,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-n-double-grating-moire",
          version: 1,
          animationCapability: "animated",
        }),
        expect.objectContaining({
          id: "an-native-owned-n-schlieren-knife-edge",
          version: 1,
          animationCapability: "animated",
        }),
        expect.objectContaining({
          id: "an-native-owned-n-doppler-wavefronts",
          version: 1,
          animationCapability: "animated",
        }),
        expect.objectContaining({
          id: "an-native-owned-n-kepler-area-sweep",
          version: 2,
          animationCapability: "animated",
        }),
      ]),
    );
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-selective-vibrance",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-threshold-solarization",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-channel-radius-blur",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-three-point-tonal-map",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-film-halation",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-fluted-refraction",
          version: 1,
          animationCapability: "static",
        }),
      ]),
    );
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-k-koch-boundary",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-k-hilbert-trace",
          version: 2,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-k-alpha-medial-ridge",
          version: 2,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-k-gamut-shoulder",
          version: 2,
          animationCapability: "static",
        }),
      ]),
    );
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-j-photo-contour-relief",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-j-waterline-mirror",
          version: 1,
          animationCapability: "static",
        }),
      ]),
    );
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-i-structure-orientation",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-i-four-plate-overprint",
          version: 1,
          animationCapability: "static",
        }),
      ]),
    );
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-log-polar-reprojection",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-julia-orbit-trap",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-torus-raymarch",
          version: 1,
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-recursive-partition-mosaic",
          version: 1,
          animationCapability: "static",
        }),
      ]),
    );
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-shadow-lift",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-bilateral-surface",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-local-rank-contrast",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-alpha-pinhole-repair",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-luminance-split-tone",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-illuminant-adaptation",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-hue-sector-relight",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-guided-local-regression",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-cylindrical-reprojection",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-f-photoelastic-stress",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-f-advected-marble",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-f-superformula-bloom",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-f-circle-inversion-web",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-f-basketweave-parquet",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-f-spherical-harmonic-surface",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-patch-affinity-denoise",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-quadrant-variance-paint",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-chroma-hold",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-mosaic-sensor",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-haar-band-remix",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-owned-cassini-field-atlas",
          animationCapability: "static",
        }),
        expect.objectContaining({
          id: "an-native-gradient-field",
          animationCapability: "animated",
        }),
      ]),
    );
    expect(result.presets).toHaveLength(463);
    expect(result.presets).toEqual(NATIVE_EFFECT_PRESETS);
    expect(result.definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "an-native-owned-shadow-lift",
          version: 1,
        }),
      ]),
    );
    expect(result.presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: GRAIN_GRADIENT_EFFECT.id,
          definitionVersion: 2,
        }),
      ]),
    );
    expect(mocks.resolveSourceWorkspace).not.toHaveBeenCalled();
  });

  it("returns full WGSL only for an exact requested definition version", async () => {
    const result = await action.run({
      format: "native-v2",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
      includeSource: true,
    });
    expect(result.selectedDefinition?.passes[0].wgsl).toContain(
      "@fragment fn fs",
    );
    await expect(
      action.run({
        format: "native-v2",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        includeSource: true,
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_definition_version_required",
    });
  });

  it("accepts the client's serialized GET query at the action route", async () => {
    const { serializeActionQueryParams } =
      await import("../../../packages/core/src/client/use-action.js");
    const { mountActionRoutes } =
      await import("../../../packages/core/src/server/action-routes.js");
    const file = { id: "file-1", filename: "index.html", fileType: "html" };
    mocks.resolveSourceWorkspace.mockResolvedValue({ files: [file] });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...file,
      content:
        '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content:
        '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      versionHash: "hash-1",
    });
    const mounted: Array<{
      path: string;
      handler: (event: unknown) => Promise<unknown>;
    }> = [];
    mountActionRoutes(
      {
        use: (path: string, handler: (event: unknown) => Promise<unknown>) =>
          mounted.push({ path, handler }),
      } as never,
      { "get-shader": action } as never,
      { getOwnerFromEvent: async () => "dev@local.test" },
    );
    const query = serializeActionQueryParams({
      format: "native-v2",
      source: { kind: "design-file", designId: "design-1", fileId: file.id },
      target: { nodeId: "hero" },
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
      includeSource: true,
    });
    const response = await mounted[0]!.handler({
      _method: "GET",
      context: {},
      req: { url: `http://app.test/_agent-native/actions/get-shader?${query}` },
    });
    expect(response).toMatchObject({
      format: "native-v2",
      targetNodeState: "present",
      selectedDefinition: {
        id: GRAIN_GRADIENT_EFFECT.id,
        version: 2,
      },
    });
    expect(JSON.stringify(response)).toContain("@fragment fn fs");

    const summaryQuery = serializeActionQueryParams({
      format: "native-v2",
      source: { kind: "design-file", designId: "design-1", fileId: file.id },
      target: { nodeId: "hero" },
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: 2,
      includeSource: false,
    });
    const summary = await mounted[0]!.handler({
      _method: "GET",
      context: {},
      req: {
        url: `http://app.test/_agent-native/actions/get-shader?${summaryQuery}`,
      },
    });
    expect(summary).toMatchObject({
      targetNodeState: "present",
      selectedDefinition: null,
    });
    expect(JSON.stringify(summary)).not.toContain("@fragment fn fs");
  });

  it("summarizes a saved manifest without returning its executable WGSL by default", async () => {
    const definition = structuredClone(GRAIN_GRADIENT_EFFECT);
    definition.properties.movement = {
      ...definition.properties.movement,
      advanced: true,
      group: "Motion",
    };
    const saved = applyNativeEffectToHtml(
      '<html><body><div data-agent-native-node-id="hero">Text</div></body></html>',
      { nodeId: "hero", definition, placement: "fill" },
    );
    expect(saved.errors).toEqual([]);
    const withPreview = editNativeEffectHtml(saved.html, {
      kind: "set-preview",
      preview: {
        quality: "auto",
        frameRateTarget: 60,
        colorMode: "display-p3",
        dynamicRange: "hdr",
      },
    });
    expect(withPreview.errors).toEqual([]);
    const file = { id: "file-1", filename: "index.html", fileType: "html" };
    mocks.resolveSourceWorkspace.mockResolvedValue({ files: [file] });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...file,
      content: withPreview.html,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: withPreview.html,
      versionHash: "hash-1",
    });
    const result = await action.run({
      format: "native-v2",
      source: { kind: "design-file", designId: "design-1", fileId: "file-1" },
      target: { nodeId: "hero" },
    });
    expect(result.targetNodeState).toBe("present");
    expect(result.document?.instances).toHaveLength(1);
    expect(result.document?.preview).toEqual({
      quality: "auto",
      frameRateTarget: 60,
      colorMode: "display-p3",
      dynamicRange: "hdr",
    });
    expect(result.document?.definitions[0].passes[0]).toMatchObject({
      id: "gradient",
      output: "color",
    });
    expect(result.document?.definitions[0].properties.movement).toMatchObject({
      advanced: true,
      group: "Motion",
    });
    expect(JSON.stringify(result.document)).not.toContain("@fragment fn fs");
    expect(JSON.stringify(result.definitions)).not.toContain("@fragment fn fs");
  });

  it("rejects unsupported selectors instead of silently returning all instances", async () => {
    await expect(
      action.run({
        format: "native-v2",
        target: { selector: ".card" },
      }),
    ).rejects.toMatchObject({
      errorCode: "native_effect_selector_unsupported",
    });
  });

  it("loads only the selected HTML body after a metadata-only workspace read", async () => {
    const selected = {
      id: "file-1",
      designId: "design-1",
      filename: "index.html",
      fileType: "html",
      updatedAt: null,
      createdAt: null,
    };
    mocks.resolveSourceWorkspace.mockResolvedValue({ files: [selected] });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...selected,
      content: "<html><body>Example</body></html>",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<html><body>Example</body></html>",
      versionHash: "hash-1",
    });
    const result = await action.run({
      format: "native-v2",
      source: { kind: "design-file", designId: "design-1", fileId: "file-1" },
    });
    expect(result.manifestState).toBe("absent");
    expect(result.approvedDefinitionHashes).toEqual([]);
    expect(mocks.resolveSourceWorkspace).toHaveBeenCalledWith("design-1", {
      includeContent: false,
      includeBoard: true,
    });
    expect(mocks.loadSelectedSourceWorkspaceFile).toHaveBeenCalledWith(
      selected,
    );
    expect(mocks.readLiveSourceFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: "file-1", content: expect.any(String) }),
    );
  });

  it("rejects a missing authored target instead of returning an empty stack", async () => {
    mocks.resolveSourceWorkspace.mockResolvedValue({
      files: [{ id: "file-1", filename: "index.html", fileType: "html" }],
    });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      id: "file-1",
      filename: "index.html",
      fileType: "html",
      content: "<div>Other</div>",
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content: "<div>Other</div>",
      versionHash: "hash-1",
    });
    await expect(
      action.run({
        format: "native-v2",
        source: { kind: "design-file", designId: "design-1", fileId: "file-1" },
        target: { nodeId: "missing" },
      }),
    ).rejects.toMatchObject({ errorCode: "native_effect_target_not_found" });
  });

  it("reports an authored target that exists only inside a template", async () => {
    const content =
      '<template><template><div data-agent-native-node-id="hero"></div></template></template>';
    const file = { id: "file-1", filename: "index.html", fileType: "html" };
    mocks.resolveSourceWorkspace.mockResolvedValue({ files: [file] });
    mocks.loadSelectedSourceWorkspaceFile.mockResolvedValue({
      ...file,
      content,
    });
    mocks.readLiveSourceFile.mockResolvedValue({
      content,
      versionHash: "hash-1",
    });
    await expect(
      action.run({
        format: "native-v2",
        source: { kind: "design-file", designId: "design-1", fileId: "file-1" },
        target: { nodeId: "hero" },
      }),
    ).rejects.toMatchObject({ errorCode: "native_effect_target_inert" });
  });
});

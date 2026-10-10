import { beforeEach, describe, expect, it, vi } from "vitest";

import { NATIVE_EFFECT_DEFINITIONS_V1 } from "../shared/native-effect-definitions-v1.js";
import {
  GRAIN_GRADIENT_EFFECT,
  NATIVE_EFFECT_DEFINITIONS,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
} from "../shared/native-effect-presets.js";
import { hashEffectDefinition } from "../shared/native-effect-trust.js";
import { encodeNativeShaderLibraryCursor } from "../shared/native-shader-library.js";

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.email,
}));
vi.mock("../server/db/index.js", async () => ({
  schema: await import("../server/db/schema.js"),
  getDb: () => ({ select: mocks.select }),
}));

import action from "./get-shader.js";

function page(rows: unknown[]) {
  const filtered = () => ({
    orderBy: () => ({ limit: async () => rows }),
    limit: async () => rows,
  });
  return {
    from: () => ({
      where: filtered,
      leftJoin: () => ({ where: filtered }),
    }),
  };
}

describe("get-shader Shader Library", () => {
  beforeEach(() => {
    mocks.email.mockReset().mockReturnValue("Maker@Example.test");
    mocks.select.mockReset();
  });

  it("keeps paginated discovery source-free while exposing compatibility and activity", async () => {
    mocks.select
      .mockReturnValueOnce(
        page([
          {
            id: "saved-1",
            name: "Reusable grain",
            description: null,
            category: "generator",
            definitionId: GRAIN_GRADIENT_EFFECT.id,
            definitionVersion: GRAIN_GRADIENT_EFFECT.version,
            executionHash: "a".repeat(64),
            kind: "generator",
            placements: '["fill"]',
            presetPlacement: "fill",
            propertyCount: 6,
            passCount: 1,
            thumbnailHandle: null,
            createdAt: "2026-10-07T00:00:00.000Z",
            updatedAt: "2026-10-07T00:00:00.000Z",
            sortAt: "2026-10-07T00:00:00.000Z",
            favorite: true,
            lastUsedAt: "2026-10-07T01:00:00.000Z",
          },
        ]),
      )
      .mockReturnValueOnce(
        page([
          {
            itemKey: `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`,
            favorite: true,
            lastUsedAt: "2026-10-07T02:00:00.000Z",
          },
        ]),
      );
    const result = await action.run({
      format: "native-v2",
      includeLibrary: true,
    });
    expect(result.library?.items).toEqual([
      expect.objectContaining({
        id: "saved-1",
        placements: ["fill"],
        favorite: true,
        itemKey: "library:saved-1",
      }),
    ]);
    expect(JSON.stringify(result.library)).not.toContain("@fragment");
    expect(result.library?.selectedEntry).toBeNull();
    const latestGrain = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (definition) => definition.id === GRAIN_GRADIENT_EFFECT.id,
    );
    expect(result.library?.builtins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: GRAIN_GRADIENT_EFFECT.id,
          version: latestGrain?.version,
          favorite: false,
          lastUsedAt: null,
        }),
      ]),
    );
  });

  it("returns validated executable source only for an exact owned entry request", async () => {
    const hash = await hashEffectDefinition(GRAIN_GRADIENT_EFFECT);
    const preset = {
      id: "library.saved-1",
      name: "Reusable grain",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      definitionVersion: GRAIN_GRADIENT_EFFECT.version,
      placement: "fill",
      params: {},
      clip: "bounds",
      provenance: { origin: "user-authored" },
    };
    mocks.select
      .mockReturnValueOnce(page([]))
      .mockReturnValueOnce(
        page([
          {
            definitionJson: JSON.stringify(GRAIN_GRADIENT_EFFECT),
            presetJson: JSON.stringify(preset),
            executionHash: hash,
          },
        ]),
      )
      .mockReturnValueOnce(page([]));
    const result = await action.run({
      format: "native-v2",
      includeLibrary: true,
      libraryEntryId: "saved-1",
      includeSource: true,
    });
    expect(result.library?.selectedEntry?.definition.passes[0].wgsl).toContain(
      "@fragment fn fs",
    );
    expect(result.library?.selectedEntry?.executionHash).toBe(hash);
  });

  it("returns persisted built-in favorites and recent activity after a fresh read", async () => {
    const builtinKey = `builtin:${GRAIN_GRADIENT_EFFECT.id}@${GRAIN_GRADIENT_EFFECT.version}`;
    for (const view of ["favorites", "recent"] as const) {
      mocks.select.mockReturnValueOnce(page([])).mockReturnValueOnce(
        page([
          {
            itemKey: builtinKey,
            favorite: true,
            lastUsedAt: "2026-10-07T02:00:00.000Z",
          },
        ]),
      );
      const result = await action.run({
        format: "native-v2",
        includeLibrary: true,
        libraryView: view,
      });
      expect(result.library?.items).toEqual([]);
      expect(result.library?.builtins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            itemKey: builtinKey,
            favorite: true,
            lastUsedAt: "2026-10-07T02:00:00.000Z",
          }),
        ]),
      );
      expect(
        result.library?.builtins.every((entry) =>
          view === "favorites" ? entry.favorite : entry.lastUsedAt !== null,
        ),
      ).toBe(true);
    }
  });

  it("keeps a pinned older built-in visible after its latest version changes", async () => {
    const older = NATIVE_EFFECT_DEFINITIONS_V1.find(
      (definition) => definition.id === GRAIN_GRADIENT_EFFECT.id,
    );
    if (!older) throw new Error("Missing pinned grain fixture");
    const olderKey = `builtin:${older.id}@${older.version}`;
    const latest = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
      (definition) => definition.id === GRAIN_GRADIENT_EFFECT.id,
    );
    if (!latest) throw new Error("Missing latest grain fixture");
    const currentKey = `builtin:${latest.id}@${latest.version}`;
    for (const view of ["all", "favorites", "recent"] as const) {
      mocks.select.mockReturnValueOnce(page([])).mockReturnValueOnce(
        page([
          {
            itemKey: olderKey,
            favorite: true,
            lastUsedAt: "2026-10-07T02:00:00.000Z",
          },
        ]),
      );
      const result = await action.run({
        format: "native-v2",
        includeLibrary: true,
        libraryView: view,
        librarySearch: "grain",
      });
      expect(
        result.library?.builtins.some((entry) => entry.itemKey === olderKey),
      ).toBe(view !== "all");
      if (view !== "all")
        expect(result.library?.builtins).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              itemKey: olderKey,
              version: older.version,
              favorite: true,
              lastUsedAt: "2026-10-07T02:00:00.000Z",
            }),
          ]),
        );
      expect(
        result.library?.builtins.some((entry) => entry.itemKey === currentKey),
      ).toBe(view === "all");
      expect(JSON.stringify(result.library)).not.toContain("@fragment");
    }
  });

  it("keeps All to one latest card for each core ID despite v1 and v2 activity", async () => {
    const historical = [
      ...NATIVE_EFFECT_DEFINITIONS_V1,
      ...NATIVE_EFFECT_DEFINITIONS,
    ];
    mocks.select.mockReturnValueOnce(page([])).mockReturnValueOnce(
      page(
        historical.map((definition) => ({
          itemKey: `builtin:${definition.id}@${definition.version}`,
          favorite: true,
          lastUsedAt: "2026-10-07T02:00:00.000Z",
        })),
      ),
    );
    const result = await action.run({
      format: "native-v2",
      includeLibrary: true,
      libraryView: "all",
    });
    const builtins = result.library?.builtins ?? [];
    expect(builtins).toHaveLength(NATIVE_EFFECT_LATEST_DEFINITIONS.length);
    expect(new Set(builtins.map((entry) => entry.id)).size).toBe(
      builtins.length,
    );
    for (const historicalDefinition of historical) {
      const latest = NATIVE_EFFECT_LATEST_DEFINITIONS.find(
        (entry) => entry.id === historicalDefinition.id,
      );
      expect(latest).toBeDefined();
      expect(
        builtins.find((entry) => entry.id === historicalDefinition.id)?.version,
      ).toBe(latest!.version);
    }
    expect(
      builtins.filter((entry) => entry.placements.includes("fill")),
    ).toHaveLength(112);
    expect(
      builtins.filter((entry) => entry.placements.includes("layer")),
    ).toHaveLength(101);
    for (const id of [
      "an-native-owned-n-rational-circle-canopy",
      "an-native-owned-n-kepler-area-sweep",
    ])
      expect(builtins, id).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, version: 2 })]),
      );
    for (const id of [
      "an-native-owned-patch-affinity-denoise",
      "an-native-owned-quadrant-variance-paint",
      "an-native-owned-chroma-hold",
      "an-native-owned-mosaic-sensor",
      "an-native-owned-haar-band-remix",
      "an-native-owned-cassini-field-atlas",
      "an-native-owned-bilateral-surface",
      "an-native-owned-local-rank-contrast",
      "an-native-owned-alpha-pinhole-repair",
      "an-native-owned-luminance-split-tone",
      "an-native-owned-illuminant-adaptation",
      "an-native-owned-hue-sector-relight",
      "an-native-owned-guided-local-regression",
      "an-native-owned-cylindrical-reprojection",
      "an-native-owned-f-photoelastic-stress",
      "an-native-owned-f-superformula-bloom",
      "an-native-owned-f-circle-inversion-web",
      "an-native-owned-f-spherical-harmonic-surface",
      "an-native-owned-i-structure-orientation",
      "an-native-owned-i-local-entropy",
      "an-native-owned-i-height-parallax",
      "an-native-owned-i-photo-sphere",
      "an-native-owned-i-triangle-facets",
      "an-native-owned-i-four-plate-overprint",
      "an-native-owned-j-photo-contour-relief",
      "an-native-owned-j-surround-reflectance",
      "an-native-owned-j-morphological-top-hat",
      "an-native-owned-j-harris-corner-marks",
      "an-native-owned-j-microlens-grid",
      "an-native-owned-j-waterline-mirror",
      "an-native-owned-k-koch-boundary",
      "an-native-owned-k-occluder-penumbra",
      "an-native-owned-k-triangle-mesh-warp",
      "an-native-owned-selective-vibrance",
      "an-native-owned-threshold-solarization",
      "an-native-owned-channel-radius-blur",
      "an-native-owned-three-point-tonal-map",
      "an-native-owned-film-halation",
      "an-native-owned-fluted-refraction",
      "an-native-owned-m-cell-dissolve",
      "an-native-owned-m-iris-aperture",
      "an-native-owned-m-page-fold",
      "an-native-owned-m-brush-liquify",
      "an-native-owned-m-watercolor-pooling",
      "an-native-owned-m-interference-edge-fringe",
      "an-native-owned-n-arc-path",
      "an-native-owned-n-double-grating-moire",
      "an-native-owned-n-schlieren-knife-edge",
      "an-native-owned-n-doppler-wavefronts",
      "an-native-owned-log-polar-reprojection",
      "an-native-owned-julia-orbit-trap",
      "an-native-owned-torus-raymarch",
      "an-native-owned-recursive-partition-mosaic",
    ])
      expect(builtins, id).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, version: 1 })]),
      );
    for (const id of [
      "an-native-owned-k-hilbert-trace",
      "an-native-owned-k-alpha-medial-ridge",
    ])
      expect(builtins, id).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, version: 2 })]),
      );
    for (const id of [
      "an-native-owned-f-advected-marble",
      "an-native-owned-f-basketweave-parquet",
    ])
      expect(builtins, id).toEqual(
        expect.arrayContaining([expect.objectContaining({ id, version: 3 })]),
      );
  });

  it("reports older rows with missing metadata as unreadable", async () => {
    mocks.select.mockReturnValueOnce(
      page([
        {
          id: "older",
          kind: null,
          placements: null,
          presetPlacement: null,
          propertyCount: null,
          passCount: null,
        },
      ]),
    );
    await expect(
      action.run({ format: "native-v2", includeLibrary: true }),
    ).rejects.toThrow("metadata is unreadable");
  });

  it("rejects pagination across different Library views before reading SQL", async () => {
    const cursor = encodeNativeShaderLibraryCursor({
      view: "favorites",
      search: "grain",
      category: "generator",
      sortAt: "2026-10-07T12:30:00.000Z",
      id: "saved-1",
    });
    await expect(
      action.run({
        format: "native-v2",
        includeLibrary: true,
        libraryView: "recent",
        librarySearch: "grain",
        libraryCategory: "generator",
        libraryCursor: cursor,
      }),
    ).rejects.toThrow("cursor is invalid");
    expect(mocks.select).not.toHaveBeenCalled();
  });
});

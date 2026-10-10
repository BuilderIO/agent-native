import { describe, expect, it } from "vitest";

import { OWNED_RENDERED_SURFACE_TEST_EFFECT } from "./native-effect-owned-source-test-fixtures";
import {
  FROSTED_REFRACTION_EFFECT,
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
  NATIVE_EFFECT_DEFINITIONS,
} from "./native-effect-presets";
import {
  applyNativeEffectToHtml,
  authoredNodeCount,
  checkEffectAssetUrl,
  inspectNativeEffectHtml,
  packNativeProperties,
  parseEffectsFromHtml,
  removeNativeInstanceFromHtml,
  updateNativeInstanceInHtml,
  validateEffectDocument,
  usesRetiredNativeImageAbi,
  writeEffectsToHtml,
  type EffectDocument,
  type NativeSourceSizing,
} from "./native-effects";

const html =
  '<html><body><div data-agent-native-node-id="hero">Editable text</div><script type="application/x-agent-native-shader" data-shader-id="legacy">legacy GLSL</script></body></html>';

describe("native effect document", () => {
  it("distinguishes readable retired image metadata from new executable definitions", () => {
    expect(usesRetiredNativeImageAbi(OWNED_RENDERED_SURFACE_TEST_EFFECT)).toBe(
      true,
    );
    expect(usesRetiredNativeImageAbi(GRAIN_GRADIENT_EFFECT)).toBe(false);
    const saved = {
      ...GRAIN_GRADIENT_EFFECT,
      resources: [
        {
          name: "source",
          kind: "texture-2d" as const,
          external: true,
          preprocess: "paper-liquid-mask" as const,
        },
      ],
    };
    expect(usesRetiredNativeImageAbi(saved)).toBe(true);
    const refused = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: OWNED_RENDERED_SURFACE_TEST_EFFECT,
      placement: "layer",
    });
    expect(refused.html).toBe(html);
    expect(refused.errors).toContain("legacy-image-abi-retired");
  });

  it("reads retired pass metadata without making the document executable", () => {
    const legacy = {
      ...GRAIN_GRADIENT_EFFECT,
      id: "saved-legacy-effect",
      passes: [
        {
          ...GRAIN_GRADIENT_EFFECT.passes[0]!,
          original: { sourceHash: "saved-metadata" },
        },
      ],
    };
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [legacy],
      instances: [],
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    expect(
      parseEffectsFromHtml(writeEffectsToHtml(html, document)).document,
    ).toEqual(document);
  });

  it("accepts explicit processor input sizing while rejecting malformed or inapplicable metadata", () => {
    const sizing: NativeSourceSizing = {
      inputSpace: "rendered-surface",
      aspectRatio: 2,
      fit: "cover",
      worldSize: [0, 0],
      origin: [0.5, 0.5],
      offset: [0, 0],
      scale: 1,
      rotationDegrees: 0,
      sampling: { min: "linear", mag: "linear", mipmap: "none" },
    };
    const instance = {
      id: "surface-on-hero",
      nodeId: "hero",
      definitionId: OWNED_RENDERED_SURFACE_TEST_EFFECT.id,
      definitionVersion: OWNED_RENDERED_SURFACE_TEST_EFFECT.version,
      placement: "layer" as const,
      params: {},
      enabled: true,
      opacity: 1,
      seed: 1,
      clip: "bounds" as const,
      blend: "normal" as const,
      timing: { speed: 1, paused: false, time: 0 },
      sourceSizing: sizing,
    };
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [OWNED_RENDERED_SURFACE_TEST_EFFECT],
      instances: [instance],
      presets: [
        {
          id: "surface-sized",
          name: "Sized surface",
          definitionId: OWNED_RENDERED_SURFACE_TEST_EFFECT.id,
          definitionVersion: OWNED_RENDERED_SURFACE_TEST_EFFECT.version,
          placement: "layer",
          params: {},
          clip: "bounds",
          provenance: { origin: "user-authored" },
          sourceSizing: sizing,
        },
      ],
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    expect(
      parseEffectsFromHtml(writeEffectsToHtml(html, document)).document
        ?.instances[0].sourceSizing,
    ).toEqual(sizing);
    expect(
      validateEffectDocument({
        ...document,
        instances: [{ ...instance, sourceSizing: { ...sizing, scale: 0 } }],
      }).errors,
    ).toContainEqual(expect.stringContaining("sourceSizing"));
    expect(
      validateEffectDocument({
        ...document,
        presets: [
          {
            ...document.presets![0],
            sourceSizing: { ...sizing, hidden: true },
          },
        ],
      }).errors,
    ).toContainEqual(expect.stringContaining("sourceSizing"));
    expect(
      validateEffectDocument({
        ...document,
        instances: [
          {
            ...instance,
            definitionId: GRAIN_GRADIENT_EFFECT.id,
            definitionVersion: GRAIN_GRADIENT_EFFECT.version,
          },
        ],
        definitions: [GRAIN_GRADIENT_EFFECT],
      }).errors,
    ).toContainEqual(expect.stringContaining("sourceSizing needs a processor"));
    expect(
      validateEffectDocument({
        ...document,
        definitions: [HALFTONE_EFFECT],
        instances: [
          {
            ...instance,
            definitionId: HALFTONE_EFFECT.id,
            definitionVersion: HALFTONE_EFFECT.version,
          },
        ],
        presets: [],
      }).errors,
    ).toContainEqual(expect.stringContaining("saved image-UV contract"));
  });
  it("validates optional preview policy without rewriting older manifests", () => {
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [],
      instances: [],
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    document.preview = { quality: "performance", frameRateTarget: 120 };
    expect(validateEffectDocument(document).errors).toEqual([]);
    document.preview = {
      quality: "performance",
      frameRateTarget: 120,
      colorMode: "display-p3",
      dynamicRange: "hdr",
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    for (const preview of [
      { ...document.preview, colorMode: "rec2020" },
      { ...document.preview, dynamicRange: "extended" },
    ]) {
      expect(
        validateEffectDocument({ ...document, preview }).errors,
      ).toContainEqual(expect.stringContaining("preview"));
    }
    const malformed = {
      ...document,
      preview: { quality: "auto", frameRateTarget: 75 },
    };
    expect(validateEffectDocument(malformed).errors).toContainEqual(
      expect.stringContaining("preview"),
    );
    const extra = {
      ...document,
      preview: { ...document.preview, hidden: true },
    };
    expect(validateEffectDocument(extra).errors).toContainEqual(
      expect.stringContaining("preview"),
    );
  });
  it("validates bounded persistent compute-to-instanced simulation without changing older definitions", () => {
    const definition = structuredClone(
      HALFTONE_EFFECT,
    ) as EffectDocument["definitions"][number];
    definition.id = "bounded-particles";
    definition.kind = "simulation";
    definition.placements = ["layer"];
    definition.inputs = undefined;
    definition.outputs = undefined;
    definition.properties = {
      quality: {
        type: "enum",
        label: "Quality",
        default: "low",
        options: ["low", "medium", "high"],
      },
    };
    definition.resources = [
      {
        name: "state",
        kind: "buffer",
        byteLength: 1_600_000,
        persistent: true,
        usage: ["storage", "copy-src", "copy-dst"],
      },
      { name: "color", kind: "texture-2d", usage: ["render", "sampled"] },
      {
        name: "trail",
        kind: "texture-2d",
        format: "rgba16float",
        persistent: true,
        usage: ["render", "sampled"],
      },
    ];
    definition.output = "trail";
    definition.simulation = {
      fixedDt: 1 / 120,
      stateResource: "state",
      bytesPerParticle: 32,
      count: {
        property: "quality",
        tiers: { low: 10000, medium: 25000, high: 50000 },
      },
      maxInteractiveSteps: 8,
      maxDeterministicSteps: 512,
      idlePointer: { x: 0.5, y: 0.5 },
    };
    definition.passes = [
      {
        id: "update",
        kind: "compute",
        wgsl: "@compute @workgroup_size(256) fn cs() {}",
        reads: [],
        previousFrameReads: ["state"],
        output: "state",
        persistent: true,
        dispatch: { workgroupSize: 256, elements: "simulation-count" },
      },
      {
        id: "paint",
        kind: "render",
        wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        reads: ["state"],
        output: "color",
        draw: { vertices: 6, instances: "simulation-count" },
      },
      {
        id: "trail-pass",
        kind: "render",
        wgsl: "@vertex fn vs() {} @fragment fn fs() {}",
        reads: ["color"],
        previousFrameReads: ["trail"],
        output: "trail",
        persistent: true,
      },
    ];
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    definition.simulation.count.tiers.high = 60000 as 50000;
    expect(validateEffectDocument(document).errors).toContainEqual(
      expect.stringContaining("simulation is invalid or unbounded"),
    );
    definition.simulation.count.tiers.high = 50000;
    definition.passes[1].draw = undefined;
    expect(validateEffectDocument(document).errors).toContainEqual(
      expect.stringContaining("persistent trail pass"),
    );
  });
  it("validates all three original definitions and their source-processing placement", () => {
    for (const definition of NATIVE_EFFECT_DEFINITIONS) {
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
        }).errors,
      ).toEqual([]);
    }
    expect(GRAIN_GRADIENT_EFFECT.placements).toEqual(["fill"]);
    expect(HALFTONE_EFFECT.passes[0].reads).toEqual(["source"]);
    expect(FROSTED_REFRACTION_EFFECT.placements).toContain("backdrop");
  });

  it("accepts bounded static effect extents and rejects malformed or excessive halos", () => {
    const definition = structuredClone(HALFTONE_EFFECT);
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
    };
    definition.extent = {
      source: { top: 0, right: 0, bottom: 0, left: 0 },
      output: { top: 24, right: 24, bottom: 24, left: 24 },
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    definition.extent.output!.left = 129;
    expect(validateEffectDocument(document).errors).toContainEqual(
      expect.stringContaining("extent.output"),
    );
    definition.extent.output!.left = Number.NaN;
    expect(validateEffectDocument(document).errors).toContainEqual(
      expect.stringContaining("extent.output"),
    );
  });

  it("validates display scaling as UI metadata without changing stored shader values", () => {
    const definition = structuredClone(GRAIN_GRADIENT_EFFECT);
    const movement = definition.properties.movement;
    if (movement.type !== "float")
      throw new TypeError("expected float fixture");
    definition.properties.movement = {
      ...movement,
      displayScale: 100,
      unit: "%",
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      }).errors,
    ).toEqual([]);
    expect(
      packNativeProperties(definition, { movement: 0.35 })[12],
    ).toBeCloseTo(0.35);
    definition.properties.movement = {
      ...movement,
      displayScale: 0,
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      }).errors,
    ).toContainEqual(expect.stringContaining("displayScale"));
  });

  it("round-trips advanced property metadata and rejects non-boolean values", () => {
    const definition = structuredClone(GRAIN_GRADIENT_EFFECT);
    const movement = definition.properties.movement;
    if (movement.type !== "float")
      throw new TypeError("expected float fixture");
    definition.properties.movement = {
      ...movement,
      advanced: true,
      group: "Motion",
      displayScale: 100,
      unit: "%",
    };
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
    };
    expect(validateEffectDocument(document).errors).toEqual([]);
    const parsed = parseEffectsFromHtml(writeEffectsToHtml(html, document));
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.definitions[0].properties.movement).toMatchObject({
      advanced: true,
      group: "Motion",
      displayScale: 100,
      unit: "%",
    });
    expect(
      packNativeProperties(definition, { movement: 0.35 })[12],
    ).toBeCloseTo(0.35);
    (definition.properties.movement as { advanced: unknown }).advanced = "yes";
    expect(validateEffectDocument(document).errors).toContainEqual(
      expect.stringContaining("advanced must be boolean"),
    );
  });

  it("round-trips a native instance while preserving legacy scripts and editable source", () => {
    const applied = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
      clip: "text",
    });
    expect(applied.errors).toEqual([]);
    expect(applied.html).toContain("Editable text");
    expect(applied.html).toContain('data-shader-id="legacy"');
    const parsed = parseEffectsFromHtml(applied.html);
    expect(parsed.errors).toEqual([]);
    expect(parsed.document?.instances[0]).toMatchObject({
      nodeId: "hero",
      clip: "text",
      placement: "fill",
    });
    const id = parsed.document!.instances[0].id;
    const updated = updateNativeInstanceInHtml(applied.html, id, {
      params: { grain: 0.2 },
      timing: { speed: 2, paused: true, time: 5, seekRevision: 1 },
    });
    expect(updated.errors).toEqual([]);
    expect(
      parseEffectsFromHtml(updated.html).document?.instances[0].params,
    ).toEqual({ grain: 0.2 });
    expect(
      parseEffectsFromHtml(updated.html).document?.instances[0].timing
        .seekRevision,
    ).toBe(1);
    const invalidSeek = updateNativeInstanceInHtml(updated.html, id, {
      timing: { speed: 2, paused: true, time: 0, seekRevision: 1.5 },
    });
    expect(invalidSeek.html).toBe(updated.html);
    expect(invalidSeek.errors).toContainEqual(
      expect.stringContaining("timing is invalid"),
    );
    const aliasedSeed = updateNativeInstanceInHtml(updated.html, id, {
      seed: 16_777_217,
    });
    expect(aliasedSeed.html).toBe(updated.html);
    expect(aliasedSeed.errors).toContainEqual(
      expect.stringContaining("seed must be an integer within 0–1000000"),
    );
    const removed = removeNativeInstanceFromHtml(updated.html, id);
    expect(removed.errors).toEqual([]);
    expect(parseEffectsFromHtml(removed.html).document).toMatchObject({
      definitions: [],
      instances: [],
    });
    expect(removed.html).toContain('data-shader-id="legacy"');
  });

  it("rejects missing or duplicated authored node IDs without changing HTML", () => {
    const missing = applyNativeEffectToHtml(html, {
      nodeId: "missing",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    expect(missing.errors[0]).toContain("found 0");
    expect(missing.html).toBe(html);
    const duplicate = applyNativeEffectToHtml(
      html.replace(
        "</body>",
        '<div data-agent-native-node-id="hero"></div></body>',
      ),
      {
        nodeId: "hero",
        definition: GRAIN_GRADIENT_EFFECT,
        placement: "fill",
      },
    );
    expect(duplicate.errors[0]).toContain("found 2");
    const scriptText =
      '<script>const fake = `<div data-agent-native-node-id="ghost">`;</script>';
    const ghost = applyNativeEffectToHtml(
      html.replace("</body>", scriptText + "</body>"),
      {
        nodeId: "ghost",
        definition: GRAIN_GRADIENT_EFFECT,
        placement: "fill",
      },
    );
    expect(ghost.errors[0]).toContain("found 0");
  });

  it("rejects manifests inside sole or nested inert templates", () => {
    const manifest =
      '<script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script>';
    for (const source of [
      `<div data-agent-native-node-id="hero"></div><template>${manifest}</template>`,
      `<div data-agent-native-node-id="hero"></div><template><template>${manifest}</template></template>`,
    ]) {
      expect(parseEffectsFromHtml(source).errors).toEqual([
        "native effect manifest inside a template is inert",
      ]);
      expect(() =>
        writeEffectsToHtml(source, {
          schemaVersion: 2,
          definitions: [],
          instances: [],
        }),
      ).toThrow("native effect manifest inside a template is inert");
      expect(
        applyNativeEffectToHtml(source, {
          nodeId: "hero",
          definition: GRAIN_GRADIENT_EFFECT,
          placement: "fill",
        }),
      ).toEqual({
        html: source,
        errors: ["native effect manifest inside a template is inert"],
      });
    }
  });

  it("rejects an inert manifest beside an active manifest without changing either", () => {
    const manifest =
      '<script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script>';
    const source = `<div data-agent-native-node-id="hero"></div>${manifest}<template>${manifest}</template>`;
    expect(parseEffectsFromHtml(source).errors).toEqual([
      "native effect manifest inside a template is inert",
    ]);
    const applied = applyNativeEffectToHtml(source, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    expect(applied.html).toBe(source);
    expect(applied.errors).toEqual([
      "native effect manifest inside a template is inert",
    ]);
  });

  it("inserts after authored tag-shaped script and comment text at the real body end", () => {
    const source =
      '<html><body><script>const marker = "</body>";</script><!-- </body> --><section data-agent-native-node-id="hero">Keep</section></body></html>';
    const result = writeEffectsToHtml(source, {
      schemaVersion: 2,
      definitions: [],
      instances: [],
    });
    expect(result).toContain(
      '<script>const marker = "</body>";</script><!-- </body> --><section data-agent-native-node-id="hero">Keep</section>',
    );
    expect(
      result.indexOf('type="application/x-agent-native-effects"'),
    ).toBeGreaterThan(result.indexOf("</section>"));
    expect(
      result.indexOf('type="application/x-agent-native-effects"'),
    ).toBeLessThan(result.lastIndexOf("</body>"));
    expect(parseEffectsFromHtml(result)).toMatchObject({
      errors: [],
      document: { schemaVersion: 2 },
    });
  });

  it("reports an unclosed active manifest instead of treating it as absent", () => {
    const source =
      '<div data-agent-native-node-id="hero"></div><script type="application/x-agent-native-effects">{"schemaVersion":2}';
    expect(parseEffectsFromHtml(source).errors).toEqual([
      "native effect manifest has no closing script tag",
    ]);
    expect(() =>
      writeEffectsToHtml(source, {
        schemaVersion: 2,
        definitions: [],
        instances: [],
      }),
    ).toThrow("native effect manifest has no closing script tag");
  });

  it("distinguishes inert-only authored targets from missing and permits an active target with an inert copy", () => {
    const inertOnly =
      '<template><template><div data-agent-native-node-id="hero"></div></template></template>';
    expect(inspectNativeEffectHtml(inertOnly, "hero").target).toEqual({
      activeCount: 0,
      inertCount: 1,
    });
    expect(inspectNativeEffectHtml(inertOnly, "missing").target).toEqual({
      activeCount: 0,
      inertCount: 0,
    });
    const rejected = applyNativeEffectToHtml(inertOnly, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    expect(rejected.html).toBe(inertOnly);
    expect(rejected.errors).toEqual([
      'authored node "hero" exists only inside an inert template',
    ]);

    const withCopy = `<div data-agent-native-node-id="hero"></div>${inertOnly}`;
    expect(authoredNodeCount(withCopy, "hero")).toBe(1);
    expect(inspectNativeEffectHtml(withCopy, "hero").target).toEqual({
      activeCount: 1,
      inertCount: 1,
    });
    const applied = applyNativeEffectToHtml(withCopy, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    expect(applied.errors).toEqual([]);
    expect(applied.html).toContain(inertOnly);
    expect(parseEffectsFromHtml(applied.html).document?.instances).toHaveLength(
      1,
    );
  });

  it("counts duplicate active authored targets even with inert copies", () => {
    const source =
      '<div data-agent-native-node-id="hero"></div><template><div data-agent-native-node-id="hero"></div></template><div data-agent-native-node-id="hero"></div>';
    expect(inspectNativeEffectHtml(source, "hero").target).toEqual({
      activeCount: 2,
      inertCount: 1,
    });
    const applied = applyNativeEffectToHtml(source, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    expect(applied.html).toBe(source);
    expect(applied.errors[0]).toContain("found 2");
  });

  it("rejects invalid overrides, NaN, and unsupported placements", () => {
    const invalid = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: HALFTONE_EFFECT,
      placement: "backdrop",
      params: { cellSize: Number.NaN },
    });
    expect(invalid.html).toBe(html);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("placement"),
        expect.stringContaining("cellSize"),
      ]),
    );
    expect(() =>
      packNativeProperties(HALFTONE_EFFECT, { cellSize: Number.NaN }),
    ).toThrow();
  });

  it("validates named input bindings, same-origin texture references, and bounded 2D transforms", () => {
    const definition = {
      ...HALFTONE_EFFECT,
      id: "test-texture-processor",
      properties: {
        ...HALFTONE_EFFECT.properties,
        useTexture: {
          type: "bool" as const,
          label: "Use texture",
          default: false,
        },
        texture: {
          type: "texture" as const,
          label: "Texture",
          default: null,
          input: "source",
          visibleWhen: { property: "useTexture", equals: true },
        },
      },
    };
    const applied = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition,
      placement: "layer",
      bindings: { source: { kind: "asset", url: "/shaders/texture.svg" } },
      transform: {
        translate: [12, -8],
        scale: [1.2, 0.8],
        rotate: 0.2,
        origin: [0.5, 0.5],
      },
    });
    expect(applied.errors).toEqual([]);
    const instance = parseEffectsFromHtml(applied.html).document!.instances[0];
    expect(instance.bindings?.source).toEqual({
      kind: "asset",
      url: "/shaders/texture.svg",
    });
    expect(instance.transform?.translate).toEqual([12, -8]);
    expect(packNativeProperties(definition, {})[20]).toBe(0);
    expect(checkEffectAssetUrl("/shaders/texture.svg")).toEqual({
      ok: true,
      url: "/shaders/texture.svg",
    });
    for (const url of [
      "https://example.test/a.png",
      "//example.test/a.png",
      "/%2e%2e/secret.png",
      "data:image/png;base64,AA",
    ])
      expect(checkEffectAssetUrl(url)).toMatchObject({ ok: false });
    expect(checkEffectAssetUrl("/%ff/texture.svg")).toMatchObject({
      ok: false,
      reason: "malformed-encoding",
    });

    const invalid = updateNativeInstanceInHtml(applied.html, instance.id, {
      bindings: {
        source: { kind: "asset", url: "https://example.test/a.png" },
      },
      transform: { scale: [0, 1] },
    });
    expect(invalid.html).toBe(applied.html);
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("same-origin root path"),
        expect.stringContaining("positive bounded factors"),
      ]),
    );
    const badInput = {
      ...definition,
      properties: {
        ...definition.properties,
        texture: { ...definition.properties.texture, input: "missing" },
      },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [badInput],
        instances: [],
      }).errors[0],
    ).toContain("matching texture or mask input");
  });

  it("rejects conditional property cycles and conflicting texture bindings", () => {
    const definition = {
      ...HALFTONE_EFFECT,
      id: "test-conditional-texture",
      properties: {
        a: {
          type: "bool" as const,
          label: "A",
          default: true,
          visibleWhen: { property: "b", equals: true },
        },
        b: {
          type: "bool" as const,
          label: "B",
          default: true,
          visibleWhen: { property: "a", equals: true },
        },
        image: {
          type: "texture" as const,
          label: "Image",
          default: null,
          input: "source",
        },
      },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      }).errors,
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("visibility cycle")]),
    );
    const validDefinition = {
      ...definition,
      properties: {
        ...definition.properties,
        a: { type: "bool" as const, label: "A", default: true },
      },
    };
    const applied = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: validDefinition,
      placement: "layer",
      params: { image: { kind: "asset", url: "/shaders/image.png" } },
      bindings: { source: { kind: "builtin", source: "source" } },
    });
    expect(applied.errors[0]).toContain("conflicts with input binding");
    expect(applied.html).toBe(html);
  });

  it("rejects duplicate IDs and unknown instance values", () => {
    const applied = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: HALFTONE_EFFECT,
      placement: "layer",
    });
    const document = parseEffectsFromHtml(applied.html).document!;
    expect(
      validateEffectDocument({
        ...document,
        instances: [...document.instances, document.instances[0]],
      }).errors,
    ).toContain(`duplicate instance id "${document.instances[0].id}"`);
    expect(
      updateNativeInstanceInHtml(applied.html, document.instances[0].id, {
        params: { bogus: 1 },
      }).errors[0],
    ).toContain("unknown property");
    expect(
      updateNativeInstanceInHtml(applied.html, document.instances[0].id, {
        params: { constructor: 1 },
      }).errors[0],
    ).toContain('unknown property "constructor"');
    expect(() =>
      packNativeProperties(HALFTONE_EFFECT, { toString: 1 }),
    ).toThrow('unknown property "toString"');
  });

  it("rejects a changed definition under an existing id and version without mutating mounted instances", () => {
    const first = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    expect(first.errors).toEqual([]);
    const changedSource = {
      ...GRAIN_GRADIENT_EFFECT,
      passes: [
        {
          ...GRAIN_GRADIENT_EFFECT.passes[0],
          wgsl: GRAIN_GRADIENT_EFFECT.passes[0].wgsl + "\n// changed",
        },
      ],
    };
    const second = applyNativeEffectToHtml(first.html, {
      nodeId: "hero",
      definition: changedSource,
      placement: "fill",
    });
    expect(second.html).toBe(first.html);
    expect(second.errors).toContain(
      `definition "${GRAIN_GRADIENT_EFFECT.id}" v${GRAIN_GRADIENT_EFFECT.version} already names different source`,
    );
    expect(parseEffectsFromHtml(second.html).document?.instances).toHaveLength(
      1,
    );
  });

  it("pins instances to distinct positive definition versions", () => {
    const first = applyNativeEffectToHtml(html, {
      nodeId: "hero",
      definition: GRAIN_GRADIENT_EFFECT,
      placement: "fill",
    });
    const revision = {
      ...GRAIN_GRADIENT_EFFECT,
      version: GRAIN_GRADIENT_EFFECT.version + 1,
    };
    const second = applyNativeEffectToHtml(first.html, {
      nodeId: "hero",
      definition: revision,
      placement: "fill",
    });
    expect(second.errors).toEqual([]);
    const document = parseEffectsFromHtml(second.html).document!;
    expect(
      document.definitions.map((definition) => definition.version),
    ).toEqual([GRAIN_GRADIENT_EFFECT.version, revision.version]);
    expect(
      document.instances.map((instance) => instance.definitionVersion),
    ).toEqual([GRAIN_GRADIENT_EFFECT.version, revision.version]);
    const removed = removeNativeInstanceFromHtml(
      second.html,
      document.instances[1].id,
    );
    expect(
      parseEffectsFromHtml(removed.html).document?.definitions.map(
        (definition) => definition.version,
      ),
    ).toEqual([GRAIN_GRADIENT_EFFECT.version]);
    expect(
      validateEffectDocument({
        ...document,
        definitions: [document.definitions[0], document.definitions[0]],
      }).errors,
    ).toContain(
      `duplicate definition id/version "${GRAIN_GRADIENT_EFFECT.id}" v${GRAIN_GRADIENT_EFFECT.version}`,
    );
    expect(
      validateEffectDocument({
        ...document,
        definitions: [
          { ...document.definitions[0], version: 0 },
          document.definitions[1],
        ],
      }).errors,
    ).toContain("definition[0].version must be a positive integer");
  });

  it("rejects oversized manifests before persisting", () => {
    const largeDefinitions = Array.from({ length: 64 }, (_, index) => ({
      ...HALFTONE_EFFECT,
      id: `huge-${index}`,
      passes: [
        {
          ...HALFTONE_EFFECT.passes[0],
          wgsl: HALFTONE_EFFECT.passes[0].wgsl + " ".repeat(30_000),
        },
      ],
    }));
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: largeDefinitions,
        instances: [],
      }).errors,
    ).toContain("effect manifest exceeds 2000000 bytes");
  });

  it("escapes script breakout text during serialization and rejects malformed manifests", () => {
    const definition = {
      ...GRAIN_GRADIENT_EFFECT,
      name: "</script><script>alert(1)</script>",
    };
    const document: EffectDocument = {
      schemaVersion: 2,
      definitions: [definition],
      instances: [],
    };
    const output = writeEffectsToHtml(html, document);
    expect(output).not.toContain("</script><script>alert(1)</script>");
    expect(output).toContain("\\u003c/script\\u003e");
    expect(parseEffectsFromHtml(output).document?.definitions[0].name).toBe(
      definition.name,
    );
    const corrupt =
      '<script type="application/x-agent-native-effects">{"schemaVersion":2,</script>';
    expect(parseEffectsFromHtml(corrupt).errors[0]).toContain("invalid JSON");
  });

  it("packs stable vec4 slots, including bounded color arrays", () => {
    const packed = packNativeProperties(GRAIN_GRADIENT_EFFECT, { grain: 0.1 });
    expect(packed).toHaveLength(128);
    expect([...packed.slice(0, 4)]).toEqual(expect.arrayContaining([1, 1]));
    expect(packed[8]).toBe(1);
    expect(packed[16]).toBeCloseTo(0.1);
    const withArray = {
      ...GRAIN_GRADIENT_EFFECT,
      properties: {
        swatches: {
          type: "color-array" as const,
          label: "Swatches",
          maxCount: 2,
          default: [
            {
              space: "srgb" as const,
              components: [1, 0, 0] as [number, number, number],
              alpha: 1,
            },
          ],
        },
      },
    };
    const array = packNativeProperties(withArray);
    expect(array[0]).toBe(1);
    expect([...array.slice(4, 8)]).toEqual([1, 0, 0, 1]);
    const p3 = packNativeProperties({
      ...withArray,
      properties: {
        swatch: {
          type: "color" as const,
          label: "P3",
          default: {
            space: "display-p3" as const,
            components: [1, 0, 0] as [number, number, number],
            alpha: 1,
          },
        },
      },
    });
    expect(p3[0]).toBeGreaterThan(1);
    expect(p3[1]).toBeLessThan(0);
    expect(() =>
      packNativeProperties(withArray, {
        swatches: [
          { space: "srgb", components: [1, 0, 0], alpha: 1 },
          { space: "srgb", components: [0, 1, 0], alpha: 1 },
          { space: "srgb", components: [0, 0, 1], alpha: 1 },
        ],
      }),
    ).toThrow();
  });

  it("accepts ten-color palettes while retaining the total uniform-slot bound", () => {
    const colors = Array.from({ length: 10 }, (_, index) => ({
      space: "srgb" as const,
      components: [index / 10, 0, 0] as [number, number, number],
      alpha: 1,
    }));
    const definition = {
      ...GRAIN_GRADIENT_EFFECT,
      properties: {
        colors: {
          type: "color-array" as const,
          label: "Colors",
          default: colors,
          maxCount: 10,
        },
        strength: {
          type: "float" as const,
          label: "Strength",
          default: 0.25,
        },
      },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [definition],
        instances: [],
      }).errors,
    ).toEqual([]);
    const packed = packNativeProperties(definition);
    expect(packed[0]).toBe(10);
    expect(packed[10 * 4 + 3]).toBe(1);
    expect(packed[11 * 4]).toBe(0.25);
    expect(() =>
      packNativeProperties(definition, { colors: [...colors, colors[0]!] }),
    ).toThrow();
    const oversized = {
      ...definition,
      properties: {
        colors: { ...definition.properties.colors, maxCount: 11 },
      },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [oversized],
        instances: [],
      }).errors,
    ).toContain('definition[0] property "colors" maxCount must be 1–10');
    const overBudget = {
      ...definition,
      properties: {
        ...definition.properties,
        ...Object.fromEntries(
          Array.from({ length: 22 }, (_, index) => [
            `extra${index}`,
            { type: "float" as const, label: `Extra ${index}`, default: 0 },
          ]),
        ),
      },
    };
    expect(
      validateEffectDocument({
        schemaVersion: 2,
        definitions: [overBudget],
        instances: [],
      }).errors,
    ).toContain("definition[0] properties need 34 vec4 slots; max is 32");
  });
});

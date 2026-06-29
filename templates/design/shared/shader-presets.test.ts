import { describe, it, expect } from "vitest";

import {
  SHADER_PRESETS,
  SHADER_PRESET_MAP,
  UNIVERSAL_PARAMS,
  getPreset,
  validateDescriptor,
  type ShaderDescriptor,
  type ShaderPresetName,
} from "./shader-presets";

const ALL_PRESET_NAMES: ShaderPresetName[] = [
  "MeshGradient",
  "GrainGradient",
  "Voronoi",
  "Metaballs",
  "Warp",
  "GodRays",
  "Dithering",
  "PaperTexture",
];

describe("SHADER_PRESETS", () => {
  it("exports exactly 8 presets", () => {
    expect(SHADER_PRESETS).toHaveLength(8);
  });

  it("every preset has name, label, and params array", () => {
    for (const preset of SHADER_PRESETS) {
      expect(typeof preset.name).toBe("string");
      expect(preset.name.length).toBeGreaterThan(0);
      expect(typeof preset.label).toBe("string");
      expect(preset.label.length).toBeGreaterThan(0);
      expect(Array.isArray(preset.params)).toBe(true);
    }
  });

  it("every preset has a non-empty description", () => {
    for (const preset of SHADER_PRESETS) {
      expect(typeof preset.description).toBe("string");
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it("all numeric params satisfy min <= default <= max", () => {
    for (const preset of SHADER_PRESETS) {
      for (const param of preset.params) {
        if (param.kind !== "number") continue;
        const value = param.default as number;

        if (param.min !== undefined) {
          expect(value).toBeGreaterThanOrEqual(param.min);
        }
        if (param.max !== undefined) {
          expect(value).toBeLessThanOrEqual(param.max);
        }
      }
    }
  });

  it("all enum params have a default that appears in options", () => {
    for (const preset of SHADER_PRESETS) {
      for (const param of preset.params) {
        if (param.kind !== "enum") continue;
        expect(param.options).toBeDefined();
        expect(param.options!).toContain(param.default);
      }
    }
  });

  it("Dithering has isEffect=true", () => {
    const dithering = SHADER_PRESETS.find((p) => p.name === "Dithering");
    expect(dithering?.isEffect).toBe(true);
  });

  it("no other preset has isEffect=true", () => {
    for (const preset of SHADER_PRESETS) {
      if (preset.name !== "Dithering") {
        expect(preset.isEffect).not.toBe(true);
      }
    }
  });

  it("grainMixer and grainOverlay are marked isExpensive", () => {
    const meshGradient = SHADER_PRESETS.find((p) => p.name === "MeshGradient");
    expect(meshGradient).toBeDefined();
    const expensive = meshGradient!.params.filter((p) => p.isExpensive);
    const expensiveKeys = expensive.map((p) => p.key);
    expect(expensiveKeys).toContain("grainMixer");
    expect(expensiveKeys).toContain("grainOverlay");
  });
});

describe("SHADER_PRESET_MAP", () => {
  it("has all 8 preset names as keys", () => {
    for (const name of ALL_PRESET_NAMES) {
      expect(SHADER_PRESET_MAP).toHaveProperty(name);
    }
  });

  it("each entry matches the corresponding SHADER_PRESETS entry", () => {
    for (const preset of SHADER_PRESETS) {
      expect(SHADER_PRESET_MAP[preset.name]).toBe(preset);
    }
  });
});

describe("UNIVERSAL_PARAMS", () => {
  it("contains fit, scale, rotation, offsetX, offsetY, speed, frame", () => {
    const keys = UNIVERSAL_PARAMS.map((p) => p.key);
    expect(keys).toContain("fit");
    expect(keys).toContain("scale");
    expect(keys).toContain("rotation");
    expect(keys).toContain("offsetX");
    expect(keys).toContain("offsetY");
    expect(keys).toContain("speed");
    expect(keys).toContain("frame");
  });

  it("fit param is an enum with 'none', 'contain', 'cover'", () => {
    const fit = UNIVERSAL_PARAMS.find((p) => p.key === "fit");
    expect(fit?.kind).toBe("enum");
    expect(fit?.options).toEqual(
      expect.arrayContaining(["none", "contain", "cover"]),
    );
  });

  it("speed param allows negative values (for reverse)", () => {
    const speed = UNIVERSAL_PARAMS.find((p) => p.key === "speed");
    expect(speed?.min).toBeLessThan(0);
  });
});

describe("getPreset", () => {
  it("returns the correct preset for 'MeshGradient'", () => {
    const preset = getPreset("MeshGradient");
    expect(preset).toBeDefined();
    expect(preset?.name).toBe("MeshGradient");
    expect(preset?.label).toBe("Mesh Gradient");
  });

  it("returns undefined for an unknown preset name", () => {
    expect(getPreset("NonExistentShader")).toBeUndefined();
    expect(getPreset("")).toBeUndefined();
  });

  it("returns the same object reference as SHADER_PRESET_MAP", () => {
    expect(getPreset("Voronoi")).toBe(SHADER_PRESET_MAP["Voronoi"]);
  });
});

describe("validateDescriptor", () => {
  it("returns valid=true for a well-formed MeshGradient descriptor", () => {
    const descriptor: ShaderDescriptor = {
      preset: "MeshGradient",
      params: { distortion: 0.5, swirl: 0.2, grainMixer: 0, grainOverlay: 0 },
      colors: ["#e0eaff", "#241d9a"],
      speed: 1,
      frame: 0,
      fit: "contain",
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=false for an unknown preset name", () => {
    const descriptor = {
      preset: "NoSuchShader" as ShaderPresetName,
      params: {},
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unknown preset"))).toBe(true);
  });

  it("returns valid=false for an unknown param key", () => {
    const descriptor: ShaderDescriptor = {
      preset: "MeshGradient",
      params: { unknownKey: 0.5 },
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Unknown param key"))).toBe(
      true,
    );
  });

  it("returns valid=false when a numeric param is below its minimum", () => {
    const descriptor: ShaderDescriptor = {
      preset: "MeshGradient",
      params: { distortion: -0.1 }, // min is 0
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("below minimum"))).toBe(true);
  });

  it("returns valid=false when a numeric param is above its maximum", () => {
    const descriptor: ShaderDescriptor = {
      preset: "Metaballs",
      params: { count: 999, size: 0.5 }, // count max is 20
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("above maximum"))).toBe(true);
  });

  it("returns valid=false when colors array exceeds maxColorCount", () => {
    const descriptor: ShaderDescriptor = {
      preset: "Voronoi", // maxColorCount=5
      params: {},
      colors: [
        "#ff0000",
        "#00ff00",
        "#0000ff",
        "#ffff00",
        "#ff00ff",
        "#00ffff",
      ], // 6 colors
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maxColorCount"))).toBe(true);
  });

  it("returns valid=true for a PaperTexture descriptor with all params at defaults", () => {
    const paperTexture = getPreset("PaperTexture")!;
    const params: Record<string, number | boolean | string> = {};
    for (const p of paperTexture.params) {
      if (p.kind === "number" || p.kind === "enum" || p.kind === "bool") {
        params[p.key] = p.default as number | boolean | string;
      }
    }
    const descriptor: ShaderDescriptor = {
      preset: "PaperTexture",
      params,
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(true);
  });

  it("returns valid=true for a Warp descriptor with all params at defaults", () => {
    const warp = getPreset("Warp")!;
    const params: Record<string, number | boolean | string> = {};
    for (const p of warp.params) {
      if (p.kind === "number" || p.kind === "enum" || p.kind === "bool") {
        params[p.key] = p.default as number | boolean | string;
      }
    }
    const descriptor: ShaderDescriptor = {
      preset: "Warp",
      params,
      colors: warp.defaultColors,
    };
    const result = validateDescriptor(descriptor);
    expect(result.valid).toBe(true);
  });
});

describe("ShaderDescriptor serialization", () => {
  it("round-trips through JSON.parse(JSON.stringify(...))", () => {
    const descriptor: ShaderDescriptor = {
      preset: "GodRays",
      params: {
        density: 0.3,
        spotty: 0.3,
        midIntensity: 0.4,
        midSize: 0.2,
        intensity: 0.8,
        bloom: 0.4,
        colorBloom: "#0000ff",
      },
      colors: ["#a600ff6e", "#6200fff0", "#ffffff", "#33fff5"],
      speed: 0.75,
      frame: 0,
      fit: "contain",
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: -0.55,
    };

    const serialized = JSON.stringify(descriptor);
    const restored = JSON.parse(serialized) as ShaderDescriptor;

    expect(restored.preset).toBe(descriptor.preset);
    expect(restored.params).toEqual(descriptor.params);
    expect(restored.colors).toEqual(descriptor.colors);
    expect(restored.speed).toBe(descriptor.speed);
    expect(restored.offsetY).toBe(descriptor.offsetY);
    expect(restored.fit).toBe(descriptor.fit);
  });

  it("a descriptor with no optional fields also round-trips cleanly", () => {
    const descriptor: ShaderDescriptor = {
      preset: "Dithering",
      params: { shape: "sphere", type: "4x4", size: 2 },
    };

    const restored = JSON.parse(JSON.stringify(descriptor)) as ShaderDescriptor;
    expect(restored).toEqual(descriptor);
  });
});

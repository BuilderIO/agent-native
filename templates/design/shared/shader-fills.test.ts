import { describe, expect, it } from "vitest";

import {
  annotateNodeWithShader,
  applyShaderToHtml,
  clearNodeShader,
  defaultUniformValues,
  ensureShaderRuntime,
  getShaderFromHtml,
  htmlHasShaderReferences,
  isSafeShaderFallbackColor,
  listShaderMounts,
  listShadersInHtml,
  newShaderId,
  parseShaderBlockBody,
  pruneUnusedShaders,
  removeShaderFromHtml,
  removeShaderFromNode,
  sanitizeShaderFallbackColor,
  serializeManifestComment,
  serializeShaderScriptBlock,
  SHADER_BUILTIN_UNIFORMS,
  SHADER_EFFECT_ATTR,
  SHADER_FILL_ATTR,
  SHADER_RUNTIME_ATTR,
  SHADER_RUNTIME_SOURCE,
  SHADER_SCRIPT_TYPE,
  upsertShaderInHtml,
  validateGlslSource,
  validateShaderDef,
  validateUniformManifest,
  type GlslShaderDef,
} from "./shader-fills";
import {
  GLSL_SHADER_PRESET_CATEGORY_LABELS,
  GLSL_SHADER_PRESETS,
  getGlslShaderPreset,
} from "./shader-presets";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SIMPLE_GLSL = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform vec3 u_tint;
uniform vec2 u_center;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float d = distance(uv, u_center);
  gl_FragColor = vec4(u_tint * (0.5 + 0.5 * sin(u_time * u_speed + d)), 1.0);
}`;

function makeDef(overrides: Partial<GlslShaderDef> = {}): GlslShaderDef {
  return {
    id: "an-shader-test0001",
    name: "Test Shader",
    mode: "fill",
    glsl: SIMPLE_GLSL,
    uniforms: {
      u_speed: {
        type: "float",
        value: 1,
        min: 0,
        max: 4,
        step: 0.01,
        label: "Speed",
      },
      u_tint: { type: "color", value: "#3366ff", label: "Tint" },
      u_center: { type: "vec2", value: [0.5, 0.5], label: "Center" },
    },
    ...overrides,
  };
}

const DOC = `<!doctype html>
<html>
<head><title>t</title></head>
<body>
  <div data-agent-native-node-id="hero" class="hero" style="color: red">Hi</div>
  <section data-agent-native-node-id="card">
    <img data-agent-native-node-id="pic" src="x.png" />
  </section>
</body>
</html>`;

// ─── Validation ──────────────────────────────────────────────────────────────

describe("validateGlslSource", () => {
  it("accepts a well-formed fragment shader", () => {
    expect(validateGlslSource(SIMPLE_GLSL).valid).toBe(true);
  });

  it("rejects empty source", () => {
    expect(validateGlslSource("").valid).toBe(false);
  });

  it("requires void main() and gl_FragColor", () => {
    const noMain = validateGlslSource("uniform float u_x; float f() {}");
    expect(noMain.valid).toBe(false);
    expect(noMain.errors.join(" ")).toMatch(/void main/);
    const noFrag = validateGlslSource("void main() { }");
    expect(noFrag.errors.join(" ")).toMatch(/gl_FragColor/);
  });

  it("rejects script-tag injection attempts", () => {
    const bad = validateGlslSource(
      SIMPLE_GLSL + "\n// </script><script>alert(1)</script>",
    );
    expect(bad.valid).toBe(false);
  });
});

describe("validateUniformManifest", () => {
  it("accepts the fixture manifest", () => {
    expect(validateUniformManifest(makeDef().uniforms).valid).toBe(true);
  });

  it("rejects reserved built-in names", () => {
    for (const name of SHADER_BUILTIN_UNIFORMS) {
      const result = validateUniformManifest({
        [name]: { type: "float", value: 0 },
      });
      expect(result.valid).toBe(false);
    }
  });

  it("rejects names that do not start with u_", () => {
    expect(
      validateUniformManifest({ speed: { type: "float", value: 1 } }).valid,
    ).toBe(false);
  });

  it("rejects out-of-range float values and non-hex colors", () => {
    expect(
      validateUniformManifest({
        u_x: { type: "float", value: 9, min: 0, max: 4 },
      }).valid,
    ).toBe(false);
    expect(
      validateUniformManifest({
        u_c: { type: "color", value: "red" },
      }).valid,
    ).toBe(false);
  });

  it("rejects malformed vec2 values", () => {
    expect(
      validateUniformManifest({
        u_v: { type: "vec2", value: 3 },
      }).valid,
    ).toBe(false);
  });
});

describe("validateShaderDef", () => {
  it("accepts the fixture", () => {
    const result = validateShaderDef(makeDef());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("cross-checks that every manifest uniform is declared in the GLSL", () => {
    const def = makeDef({
      uniforms: {
        ...makeDef().uniforms,
        u_ghost: { type: "float", value: 1 },
      },
    });
    const result = validateShaderDef(def);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/u_ghost/);
  });

  it("checks that color uniforms are declared as vec3", () => {
    const def = makeDef({
      glsl: SIMPLE_GLSL.replace("uniform vec3 u_tint;", "uniform vec4 u_tint;"),
    });
    expect(validateShaderDef(def).valid).toBe(false);
  });

  it("rejects invalid ids and forbidden name sequences", () => {
    expect(validateShaderDef(makeDef({ id: "bad id!" })).valid).toBe(false);
    expect(validateShaderDef(makeDef({ name: "x*/</script>" })).valid).toBe(
      false,
    );
  });
});

describe("fallback color safety", () => {
  it("accepts common safe colors", () => {
    for (const color of [
      "#fff",
      "#a1b2c3",
      "rgba(0, 10, 20, 0.5)",
      "hsl(120, 50%, 40%)",
      "oklch(0.7 0.1 200)",
      "tomato",
    ]) {
      expect(isSafeShaderFallbackColor(color)).toBe(true);
    }
  });

  it("neutralizes unsafe values", () => {
    for (const color of [
      "red; background-image: url(x)",
      "url(javascript:x)",
      "#fff}</style>",
      "expression(alert(1))",
    ]) {
      expect(sanitizeShaderFallbackColor(color)).toBe("#808080");
    }
  });
});

// ─── Serialization round-trips ───────────────────────────────────────────────

describe("shader block serialization", () => {
  it("round-trips a definition through serialize + parse", () => {
    const def = makeDef();
    const html = `<html><body>${serializeShaderScriptBlock(def)}</body></html>`;
    const parsed = listShadersInHtml(html);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(def);
  });

  it("parses the manifest out of the leading block comment", () => {
    const body =
      serializeManifestComment(makeDef().uniforms) + "\n" + SIMPLE_GLSL;
    const parsed = parseShaderBlockBody(body);
    expect(parsed.uniforms).toEqual(makeDef().uniforms);
    expect(parsed.glsl).toBe(SIMPLE_GLSL);
  });

  it("degrades gracefully when the manifest comment is missing", () => {
    const parsed = parseShaderBlockBody(SIMPLE_GLSL);
    expect(parsed.uniforms).toEqual({});
    expect(parsed.glsl).toBe(SIMPLE_GLSL);
  });

  it("escapes shader names in attributes", () => {
    const def = makeDef({ name: 'A "quoted" & <named> shader' });
    const html = `<body>${serializeShaderScriptBlock(def)}</body>`;
    expect(listShadersInHtml(html)[0].name).toBe(def.name);
  });

  it("upsert replaces an existing block with the same id", () => {
    const def = makeDef();
    let html = upsertShaderInHtml(DOC, def);
    html = upsertShaderInHtml(html, {
      ...def,
      name: "Renamed",
      uniforms: { ...def.uniforms },
    });
    const parsed = listShadersInHtml(html);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Renamed");
    // Inserted before </body>, exactly once.
    expect(html.match(new RegExp(SHADER_SCRIPT_TYPE, "g"))).toHaveLength(1);
  });

  it("removeShaderFromHtml deletes the block", () => {
    const def = makeDef();
    const html = upsertShaderInHtml(DOC, def);
    const removed = removeShaderFromHtml(html, def.id);
    expect(listShadersInHtml(removed)).toHaveLength(0);
    expect(getShaderFromHtml(removed, def.id)).toBeUndefined();
  });
});

// ─── Runtime embedding ───────────────────────────────────────────────────────

describe("shader runtime embedding", () => {
  it("runtime source is embeddable (no closing script tag, IIFE, versioned)", () => {
    expect(SHADER_RUNTIME_SOURCE.length).toBeGreaterThan(1000);
    expect(/<\/script/i.test(SHADER_RUNTIME_SOURCE)).toBe(false);
    expect(SHADER_RUNTIME_SOURCE).toContain("__anShaders");
    expect(SHADER_RUNTIME_SOURCE).toContain(
      "application/x-agent-native-shader",
    );
  });

  it("ensureShaderRuntime is idempotent", () => {
    const once = ensureShaderRuntime(DOC);
    const twice = ensureShaderRuntime(once);
    expect(twice).toBe(once);
    expect(once.match(new RegExp(SHADER_RUNTIME_ATTR, "g"))).toHaveLength(1);
    expect(once.indexOf("</body>")).toBeGreaterThan(
      once.indexOf(SHADER_RUNTIME_ATTR),
    );
  });

  it("upgrades a stale embedded runtime in place", () => {
    const stale = DOC.replace(
      "</body>",
      `<script ${SHADER_RUNTIME_ATTR} data-runtime-version="0">old()</script></body>`,
    );
    const upgraded = ensureShaderRuntime(stale);
    expect(upgraded).not.toContain("old()");
    expect(upgraded.match(new RegExp(SHADER_RUNTIME_ATTR, "g"))).toHaveLength(
      1,
    );
    expect(upgraded).toContain("__anShaders");
  });
});

// ─── Element annotation ──────────────────────────────────────────────────────

describe("element annotation", () => {
  it("annotates a fill node with attrs + fallback background", () => {
    const result = annotateNodeWithShader(DOC, {
      nodeId: "hero",
      shaderId: "an-shader-test0001",
      mode: "fill",
      values: { u_speed: 2 },
      fallbackColor: "#123456",
    });
    expect(result.errors).toEqual([]);
    expect(result.changed).toBe(true);
    expect(result.html).toContain(`${SHADER_FILL_ATTR}="an-shader-test0001"`);
    expect(result.html).toContain("background: #123456");
    // Existing style declarations survive.
    expect(result.html).toContain("color: red");
    const mounts = listShaderMounts(result.html);
    expect(mounts).toEqual([
      {
        nodeId: "hero",
        shaderId: "an-shader-test0001",
        mode: "fill",
        values: { u_speed: 2 },
      },
    ]);
  });

  it("leaves the background untouched when no fallback color is given", () => {
    const result = annotateNodeWithShader(DOC, {
      nodeId: "hero",
      shaderId: "an-shader-test0001",
      mode: "fill",
      values: { u_speed: 2 },
    });
    expect(result.errors).toEqual([]);
    // Original inline style survives unchanged; no background injected.
    expect(result.html).toContain('style="color: red"');
    expect(result.html).not.toContain("background:");
  });

  it("annotates an effect node without touching the background", () => {
    const result = annotateNodeWithShader(DOC, {
      nodeId: "card",
      shaderId: "an-shader-fx1",
      mode: "effect",
    });
    expect(result.errors).toEqual([]);
    expect(result.html).toContain(`${SHADER_EFFECT_ATTR}="an-shader-fx1"`);
    expect(result.html).not.toContain('an-shader-fx1" style=');
    expect(listShaderMounts(result.html)[0].mode).toBe("effect");
  });

  it("re-annotating the same mode swaps the reference", () => {
    const first = annotateNodeWithShader(DOC, {
      nodeId: "hero",
      shaderId: "an-shader-a",
      mode: "fill",
    });
    const second = annotateNodeWithShader(first.html, {
      nodeId: "hero",
      shaderId: "an-shader-b",
      mode: "fill",
    });
    expect(second.html).not.toContain(`${SHADER_FILL_ATTR}="an-shader-a"`);
    const mounts = listShaderMounts(second.html);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toMatchObject({ shaderId: "an-shader-b", mode: "fill" });
  });

  it("a fill and an effect coexist on the same element (Figma stacking)", () => {
    const withFill = annotateNodeWithShader(DOC, {
      nodeId: "hero",
      shaderId: "an-shader-a",
      mode: "fill",
      values: { u_speed: 1 },
    });
    const withBoth = annotateNodeWithShader(withFill.html, {
      nodeId: "hero",
      shaderId: "an-shader-b",
      mode: "effect",
      values: { u_intensity: 0.3 },
    });
    const mounts = listShaderMounts(withBoth.html);
    expect(mounts).toHaveLength(2);
    expect(mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shaderId: "an-shader-a",
          mode: "fill",
          values: { u_speed: 1 },
        }),
        expect.objectContaining({
          shaderId: "an-shader-b",
          mode: "effect",
          values: { u_intensity: 0.3 },
        }),
      ]),
    );
    // Removing only the effect keeps the fill.
    const effectRemoved = clearNodeShader(withBoth.html, "hero", "effect");
    const remaining = listShaderMounts(effectRemoved.html);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].mode).toBe("fill");
  });

  it("refuses void elements", () => {
    const result = annotateNodeWithShader(DOC, {
      nodeId: "pic",
      shaderId: "an-shader-x",
      mode: "fill",
    });
    expect(result.changed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/<img>/);
  });

  it("reports missing nodes", () => {
    const result = annotateNodeWithShader(DOC, {
      nodeId: "nope",
      shaderId: "an-shader-x",
      mode: "fill",
    });
    expect(result.changed).toBe(false);
    expect(result.errors.join(" ")).toMatch(/nope/);
  });

  it("clearNodeShader removes annotations but keeps the fallback fill", () => {
    const applied = annotateNodeWithShader(DOC, {
      nodeId: "hero",
      shaderId: "an-shader-a",
      mode: "fill",
      fallbackColor: "#abcdef",
    });
    const cleared = clearNodeShader(applied.html, "hero");
    expect(cleared.changed).toBe(true);
    expect(listShaderMounts(cleared.html)).toHaveLength(0);
    expect(cleared.html).toContain("background: #abcdef");
  });
});

// ─── High-level apply / persistence round-trip ──────────────────────────────

describe("applyShaderToHtml", () => {
  it("performs the full persistence transform in one call", () => {
    const def = makeDef();
    const result = applyShaderToHtml(DOC, {
      nodeId: "hero",
      def,
      values: { u_speed: 3 },
      fallbackColor: "#334455",
    });
    expect(result.errors).toEqual([]);
    expect(result.changed).toBe(true);

    // 1. Definition block present and parseable.
    expect(listShadersInHtml(result.html)).toEqual([def]);
    // 2. Runtime embedded exactly once.
    expect(
      result.html.match(new RegExp(SHADER_RUNTIME_ATTR, "g")),
    ).toHaveLength(1);
    // 3. Element annotated with overrides + fallback.
    expect(listShaderMounts(result.html)).toEqual([
      {
        nodeId: "hero",
        shaderId: def.id,
        mode: "fill",
        values: { u_speed: 3 },
      },
    ]);
    expect(htmlHasShaderReferences(result.html)).toBe(true);

    // Re-applying with tweaked uniforms stays single-block, single-runtime.
    const again = applyShaderToHtml(result.html, {
      nodeId: "hero",
      def: { ...def, uniforms: { ...def.uniforms } },
      values: { u_speed: 0.5 },
    });
    expect(listShadersInHtml(again.html)).toHaveLength(1);
    expect(again.html.match(new RegExp(SHADER_RUNTIME_ATTR, "g"))).toHaveLength(
      1,
    );
  });

  it("rejects invalid definitions without touching the html", () => {
    const bad = applyShaderToHtml(DOC, {
      nodeId: "hero",
      def: makeDef({ glsl: "nope" }),
    });
    expect(bad.changed).toBe(false);
    expect(bad.html).toBe(DOC);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("removeShaderFromNode clears the node and prunes orphaned defs", () => {
    const def = makeDef();
    const applied = applyShaderToHtml(DOC, { nodeId: "hero", def });
    const removed = removeShaderFromNode(applied.html, "hero");
    expect(removed.errors).toEqual([]);
    expect(listShaderMounts(removed.html)).toHaveLength(0);
    expect(listShadersInHtml(removed.html)).toHaveLength(0);
  });

  it("pruneUnusedShaders keeps referenced defs", () => {
    const def = makeDef();
    const applied = applyShaderToHtml(DOC, { nodeId: "hero", def });
    expect(listShadersInHtml(pruneUnusedShaders(applied.html))).toHaveLength(1);
  });
});

// ─── Misc helpers ────────────────────────────────────────────────────────────

describe("misc helpers", () => {
  it("newShaderId produces valid unique ids", () => {
    const ids = new Set(Array.from({ length: 64 }, () => newShaderId()));
    expect(ids.size).toBe(64);
    for (const id of ids) {
      expect(id).toMatch(/^an-shader-[a-z0-9]{8}$/);
    }
  });

  it("defaultUniformValues mirrors the manifest", () => {
    expect(defaultUniformValues(makeDef())).toEqual({
      u_speed: 1,
      u_tint: "#3366ff",
      u_center: [0.5, 0.5],
    });
  });
});

// ─── GLSL preset library sanity ──────────────────────────────────────────────

describe("GLSL shader preset library", () => {
  it("ships 12 presets: 9 fills + 3 effects", () => {
    expect(GLSL_SHADER_PRESETS.length).toBe(12);
    expect(
      GLSL_SHADER_PRESETS.filter((preset) => preset.mode === "fill").length,
    ).toBe(9);
    expect(
      GLSL_SHADER_PRESETS.filter((preset) => preset.mode === "effect").length,
    ).toBe(3);
  });

  it("has unique kebab-case names and unique labels", () => {
    const names = GLSL_SHADER_PRESETS.map((preset) => preset.name);
    const labels = GLSL_SHADER_PRESETS.map((preset) => preset.label);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every preset is a fully valid shader definition", () => {
    for (const preset of GLSL_SHADER_PRESETS) {
      const def: GlslShaderDef = {
        id: "an-shader-preset01",
        name: preset.label,
        mode: preset.mode,
        glsl: preset.glsl,
        uniforms: preset.uniforms,
      };
      const result = validateShaderDef(def);
      expect(
        result.errors,
        `preset "${preset.name}" failed validation`,
      ).toEqual([]);
    }
  });

  it("every preset round-trips through the persisted format", () => {
    for (const preset of GLSL_SHADER_PRESETS) {
      const def: GlslShaderDef = {
        id: "an-shader-rt000001",
        name: preset.label,
        mode: preset.mode,
        glsl: preset.glsl,
        uniforms: preset.uniforms,
      };
      const applied = applyShaderToHtml(DOC, {
        nodeId: "hero",
        def,
        fallbackColor: "#101010",
      });
      expect(applied.errors, `preset "${preset.name}" failed to apply`).toEqual(
        [],
      );
      expect(listShadersInHtml(applied.html)).toEqual([def]);
    }
  });

  it("declares the built-in uniforms it relies on", () => {
    for (const preset of GLSL_SHADER_PRESETS) {
      expect(preset.glsl).toContain("uniform vec2 u_resolution;");
      expect(preset.glsl).toContain("uniform float u_time;");
      expect(preset.glsl).toContain("precision highp float;");
    }
  });

  it("has a valid category and safe preview CSS for each preset", () => {
    for (const preset of GLSL_SHADER_PRESETS) {
      expect(
        GLSL_SHADER_PRESET_CATEGORY_LABELS[preset.category],
        `preset "${preset.name}" has unknown category "${preset.category}"`,
      ).toBeTruthy();
      expect(preset.previewCss.length).toBeGreaterThan(0);
      expect(preset.previewCss).not.toMatch(/[;{}<>]|url\s*\(/i);
      expect(preset.description.length).toBeGreaterThan(10);
    }
  });

  it("keeps float knob metadata coherent (min < max, value in range)", () => {
    for (const preset of GLSL_SHADER_PRESETS) {
      for (const [name, u] of Object.entries(preset.uniforms)) {
        if (u.type !== "float") continue;
        expect(u.min, `${preset.name}.${name} min`).toBeDefined();
        expect(u.max, `${preset.name}.${name} max`).toBeDefined();
        expect(u.step, `${preset.name}.${name} step`).toBeDefined();
        expect(u.min as number).toBeLessThan(u.max as number);
        expect(u.value as number).toBeGreaterThanOrEqual(u.min as number);
        expect(u.value as number).toBeLessThanOrEqual(u.max as number);
      }
    }
  });

  it("getGlslShaderPreset resolves by name", () => {
    expect(getGlslShaderPreset("water-caustics")?.label).toBe("Water Caustics");
    expect(getGlslShaderPreset("missing")).toBeUndefined();
  });
});

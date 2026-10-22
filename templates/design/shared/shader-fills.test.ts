import { describe, expect, it } from "vitest";

import {
  buildShaderRuntimeScriptTag,
  clearNodeShader,
  ensureNativeShaderRuntime,
  ensureShaderRuntime,
  htmlHasShaderReferences,
  listShaderMounts,
  listShadersInHtml,
  NATIVE_SHADER_RUNTIME_SOURCE,
  parseShaderBlockBody,
  pruneUnusedShaders,
  removeShaderFill,
  removeShaderFromHtml,
  removeShaderFromNode,
  replaceForeignShaderRuntime,
  SHADER_RUNTIME_ATTR,
  SHADER_RUNTIME_SOURCE,
  SHADER_SCRIPT_TYPE,
  stripGeneratedShaderRuntimes,
  unescapeShaderScriptBreakout,
  type GlslShaderDef,
} from "./shader-fills";

const SIMPLE_GLSL = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform vec3 u_tint;
void main() {
  gl_FragColor = vec4(u_tint * u_speed, 1.0);
}`;

const DEF: GlslShaderDef = {
  id: "an-shader-test0001",
  name: "Saved shader",
  mode: "fill",
  glsl: SIMPLE_GLSL,
  uniforms: {
    u_speed: { type: "float", value: 1, min: 0, max: 4, step: 0.01 },
    u_tint: { type: "color", value: "#3366ff" },
  },
};

function savedBlock(def = DEF): string {
  return `<script type="${SHADER_SCRIPT_TYPE}" data-shader-id="${def.id}" data-shader-name="${def.name}" data-shader-mode="${def.mode}">
/*! an-shader v1
${JSON.stringify({ uniforms: def.uniforms }, null, 2)}
*/
${def.glsl}
</script>`;
}

const DOC = `<!doctype html><html><body>
<div data-agent-native-node-id="hero" data-an-shader-fill="an-shader-test0001" data-an-shader-uniforms='{"u_speed":2}' style="background: #334455; color: red">Hi</div>
<section data-agent-native-node-id="card"></section>
${savedBlock()}
</body></html>`;

describe("saved GLSL parsing", () => {
  it("reads the persisted definition and manifest", () => {
    expect(listShadersInHtml(DOC)).toEqual([DEF]);
    const block = savedBlock();
    const body = block.slice(
      block.indexOf(">\n") + 2,
      block.lastIndexOf("</script>"),
    );
    expect(parseShaderBlockBody(body).uniforms).toEqual(DEF.uniforms);
  });

  it("reads legacy source without a manifest and unescapes saved script markers", () => {
    expect(parseShaderBlockBody(SIMPLE_GLSL)).toEqual({
      uniforms: {},
      glsl: SIMPLE_GLSL,
    });
    const escaped = `${SIMPLE_GLSL}\n// <\\/script> comment`;
    expect(unescapeShaderScriptBreakout(escaped)).toContain("</script>");
    expect(parseShaderBlockBody(escaped).glsl).toContain("</script>");
  });

  it("skips invalid IDs and keeps a sibling readable after malformed stored content", () => {
    const malformed = `<script type="${SHADER_SCRIPT_TYPE}" data-shader-id="bad id">broken</script>`;
    expect(listShadersInHtml(`${malformed}${DOC}`)).toEqual([DEF]);
  });

  it("reads saved fill and effect mounts, including single-quoted overrides", () => {
    const html = DOC.replace(
      '<section data-agent-native-node-id="card"></section>',
      `<section data-agent-native-node-id="card" data-an-shader-effect="an-shader-fx" data-an-shader-effect-uniforms='{"u_intensity":0.2}'></section>`,
    );
    expect(listShaderMounts(html)).toEqual([
      {
        nodeId: "hero",
        shaderId: DEF.id,
        mode: "fill",
        values: { u_speed: 2 },
      },
      {
        nodeId: "card",
        shaderId: "an-shader-fx",
        mode: "effect",
        values: { u_intensity: 0.2 },
      },
    ]);
  });
});

describe("saved GLSL runtime", () => {
  it("embeds one versioned runtime and replaces an old marked runtime", () => {
    expect(SHADER_RUNTIME_SOURCE).toContain("__anShaders");
    expect(/<\/script/i.test(SHADER_RUNTIME_SOURCE)).toBe(false);
    const once = ensureShaderRuntime(DOC);
    expect(ensureShaderRuntime(once)).toBe(once);
    expect(once).toContain(buildShaderRuntimeScriptTag());
    const stale = DOC.replace(
      "</body>",
      `<script ${SHADER_RUNTIME_ATTR} data-runtime-version="0">old()</script></body>`,
    );
    expect(replaceForeignShaderRuntime(stale)).not.toContain("old()");
  });

  it("leaves an unmarked document unchanged on replacement", () => {
    expect(replaceForeignShaderRuntime(DOC)).toBe(DOC);
  });

  it("injects and strips only the verified native runtime", () => {
    const once = ensureNativeShaderRuntime(DOC);
    expect(once).toContain(NATIVE_SHADER_RUNTIME_SOURCE);
    expect(ensureNativeShaderRuntime(once)).toBe(once);
    const stripped = stripGeneratedShaderRuntimes(once);
    expect(stripped).not.toContain("data-agent-native-native-shader-runtime");
    expect(listShadersInHtml(stripped)).toEqual([DEF]);
    const forged = DOC.replace(
      "</body>",
      '<script data-agent-native-native-shader-runtime data-runtime-version="2">old()</script></body>',
    );
    expect(() => ensureNativeShaderRuntime(forged)).toThrow(
      "unrecognized content",
    );
    expect(stripGeneratedShaderRuntimes(forged)).toBe(forged);
  });
});

describe("saved GLSL removal", () => {
  it("clears one annotation while preserving its fallback background", () => {
    const cleared = clearNodeShader(DOC, "hero", "fill");
    expect(cleared.errors).toEqual([]);
    expect(listShaderMounts(cleared.html)).toEqual([]);
    expect(cleared.html).toContain("background: #334455");
  });

  it("prunes an orphan definition and runtime after the final mount is removed", () => {
    const mounted = ensureShaderRuntime(DOC);
    expect(htmlHasShaderReferences(mounted)).toBe(true);
    expect(listShadersInHtml(pruneUnusedShaders(mounted))).toEqual([DEF]);
    const removed = removeShaderFromNode(mounted, "hero", "fill");
    expect(removed.errors).toEqual([]);
    expect(listShadersInHtml(removed.html)).toEqual([]);
    expect(listShaderMounts(removed.html)).toEqual([]);
    expect(removed.html).not.toContain(SHADER_RUNTIME_ATTR);
    expect(removed.html).toContain("background: #334455");
    expect(htmlHasShaderReferences(removed.html)).toBe(false);
  });

  it("removes only a named definition block", () => {
    const html = `${DOC}${savedBlock({ ...DEF, id: "an-shader-second" })}`;
    const removed = removeShaderFromHtml(html, DEF.id);
    expect(listShadersInHtml(removed).map((def) => def.id)).toEqual([
      "an-shader-second",
    ]);
  });

  it("removes a fill fallback but keeps unrelated styles and image layers", () => {
    const html = DOC.replace(
      "background: #334455; color: red",
      "background: #334455; background-color: #ffffff; background-image: url(a.png); color: red",
    );
    const removed = removeShaderFill(html, "hero");
    expect(removed.errors).toEqual([]);
    expect(removed.html).not.toContain("background: #334455");
    expect(removed.html).not.toContain("background-color:");
    expect(removed.html).toContain("background-image: url(a.png)");
    expect(removed.html).toContain("color: red");
  });

  it("reports missing nodes without modifying the document", () => {
    const result = removeShaderFill(DOC, "missing");
    expect(result).toEqual({
      html: DOC,
      changed: false,
      errors: ['no element with data-agent-native-node-id="missing" found'],
    });
  });
});

import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  applyShaderToHtml,
  SHADER_RUNTIME_SOURCE,
  type GlslShaderDef,
} from "../../../../shared/shader-fills";

const PAGE = `<!doctype html>
<html>
<head><style>html,body{margin:0}#host{width:320px;height:240px}</style></head>
<body>
  <div id="host" data-agent-native-node-id="host"><p>content</p></div>
</body>
</html>`;

const savedFill: GlslShaderDef = {
  id: "an-shader-fill0001",
  name: "Saved fill",
  mode: "fill",
  glsl: `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_tint;
uniform float u_gain;
void main() {
  vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));
  gl_FragColor = vec4(u_tint * (0.5 + 0.5 * uv.x) * u_gain, 1.0);
}`,
  uniforms: {
    u_tint: { type: "color", value: "#3366ff", label: "Tint" },
    u_gain: {
      type: "float",
      value: 1,
      min: 0,
      max: 2,
      step: 0.1,
      label: "Gain",
    },
  },
};

const savedEffect: GlslShaderDef = {
  id: "an-shader-fx000001",
  name: "Saved effect",
  mode: "effect",
  glsl: `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
void main() {
  gl_FragColor = vec4(0.1, 0.2, 0.3, 0.35);
}`,
  uniforms: {},
};

describe("GLSL shader runtime — real browser", () => {
  it(
    "saved authored shaders compile in WebGL and the runtime mounts fills + effects",
    { timeout: 120_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 500, height: 400 },
        });
        const pageErrors: string[] = [];
        page.on("pageerror", (err) => pageErrors.push(err.message));

        await page.setContent("<canvas id=probe></canvas>");
        const webglAvailable = await page.evaluate(() => {
          try {
            const canvas = document.querySelector(
              "#probe",
            ) as HTMLCanvasElement;
            return Boolean(
              canvas.getContext("webgl") ||
              canvas.getContext("experimental-webgl"),
            );
          } catch {
            return false;
          }
        });

        const failures: string[] = [];
        for (const def of [savedFill, savedEffect]) {
          const applied = applyShaderToHtml(PAGE, {
            nodeId: "host",
            def,
            ...(def.mode === "fill" ? { fallbackColor: "#101010" } : {}),
          });
          expect(applied.errors, `${def.name} failed to apply`).toEqual([]);

          await page.setContent(applied.html, { waitUntil: "load" });
          await page.waitForTimeout(250);

          const state = await page.evaluate(() => {
            const host = document.querySelector("#host") as HTMLElement;
            const canvas = host.querySelector(
              "canvas[data-an-shader-canvas]",
            ) as HTMLCanvasElement | null;
            return {
              error: host.getAttribute("data-an-shader-error"),
              hasCanvas: Boolean(canvas),
              canvasSized: canvas
                ? canvas.width > 0 && canvas.height > 0
                : false,
              runtimePresent: Boolean(
                (window as unknown as { __anShaders?: { version: number } })
                  .__anShaders,
              ),
            };
          });

          expect(
            state.runtimePresent,
            `${def.name}: embedded runtime did not boot`,
          ).toBe(true);

          if (webglAvailable) {
            if (state.error || !state.hasCanvas) {
              failures.push(
                `${def.name}: ${state.error ?? "no canvas mounted"}`,
              );
            } else {
              expect(
                state.canvasSized,
                `${def.name}: canvas has zero size`,
              ).toBe(true);
            }
          } else {
            expect(state.hasCanvas).toBe(false);
            expect(state.error).toBe("webgl-unavailable");
          }
        }

        expect(
          failures,
          "saved shaders failed to compile/mount in a real WebGL context",
        ).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "fill + effect coexist on one element and uniform overrides apply",
    { timeout: 60_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: 500, height: 400 },
        });
        const fillPreset = savedFill;
        const effectPreset = savedEffect;
        const firstFloat = Object.entries(fillPreset.uniforms).find(
          ([, u]) => u.type === "float",
        );

        let html = applyShaderToHtml(PAGE, {
          nodeId: "host",
          def: {
            id: "an-shader-fill0001",
            name: "Fill",
            mode: "fill",
            glsl: fillPreset.glsl,
            uniforms: fillPreset.uniforms,
          },
          fallbackColor: "#123456",
          ...(firstFloat
            ? { values: { [firstFloat[0]]: firstFloat[1].value } }
            : {}),
        }).html;
        html = applyShaderToHtml(html, {
          nodeId: "host",
          def: {
            id: "an-shader-fx000001",
            name: "Effect",
            mode: "effect",
            glsl: effectPreset.glsl,
            uniforms: effectPreset.uniforms,
          },
        }).html;

        await page.setContent(html, { waitUntil: "load" });
        await page.waitForTimeout(250);

        const state = await page.evaluate(() => {
          const host = document.querySelector("#host") as HTMLElement;
          const canvases = Array.from(
            host.querySelectorAll("canvas[data-an-shader-canvas]"),
          ) as HTMLCanvasElement[];
          const webglOk = (() => {
            try {
              const probe = document.createElement("canvas");
              return Boolean(
                probe.getContext("webgl") ||
                probe.getContext("experimental-webgl"),
              );
            } catch {
              return false;
            }
          })();
          return {
            webglOk,
            canvasCount: canvases.length,
            zIndexes: canvases.map((c) => c.style.zIndex),
            fallbackBackground: host.style.background,
          };
        });

        expect(
          state.fallbackBackground.includes("#123456") ||
            state.fallbackBackground.includes("rgb(18, 52, 86)"),
          `fallback background missing: "${state.fallbackBackground}"`,
        ).toBe(true);
        if (state.webglOk) {
          expect(state.canvasCount).toBe(2);
          expect(state.zIndexes).toContain("-1");
          expect(
            state.zIndexes.some((z) => Number(z) > 1000),
            "effect canvas should overlay content",
          ).toBe(true);
        } else {
          expect(state.canvasCount).toBe(0);
        }
      } finally {
        await browser.close();
      }
    },
  );
});

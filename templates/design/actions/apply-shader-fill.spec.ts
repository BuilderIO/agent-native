/**
 * apply-shader-fill.spec.ts
 *
 * Unit tests for the persisting shader-fill apply path.
 *
 * The action itself requires a live DB + collab runtime, so (following the
 * apply-motion-edit.spec.ts pattern) these tests cover:
 *
 *  1. The pure helper that produces the value the action persists
 *     (`buildShaderFillBackground`) — proving the colour/param allowlist and the
 *     persisted CSS `background` output.
 *  2. The action's contract via static source inspection — proving it asserts
 *     editor access, only persists HTML design-file sources, validates the
 *     descriptor before writing, and goes through the deterministic HTML editor.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildShaderFillBackground,
  generateShaderFillFallbackCss,
} from "../shared/shader-fill";
import type { ShaderDescriptor } from "../shared/shader-presets";

// ─── 1. Persisted value: colour/param allowlist + CSS output ──────────────────

describe("buildShaderFillBackground — persisted CSS background", () => {
  it("returns the same gradient the preview renders for a MeshGradient", () => {
    const descriptor: ShaderDescriptor = {
      preset: "MeshGradient",
      params: {},
      colors: ["#e0eaff", "#241d9a"],
    };
    const { background, colors } = buildShaderFillBackground(descriptor);
    expect(background).toBe(
      "conic-gradient(from 0deg at 50% 50%, #e0eaff 0deg, #241d9a 180deg, #e0eaff 360deg)",
    );
    expect(colors).toEqual(["#e0eaff", "#241d9a"]);
  });

  it("falls back to preset default colours when none are supplied", () => {
    const descriptor: ShaderDescriptor = { preset: "MeshGradient", params: {} };
    const { background, colors } = buildShaderFillBackground(descriptor);
    // MeshGradient defaultColors from the manifest.
    expect(colors).toEqual(["#e0eaff", "#241d9a", "#f75092", "#9f50d3"]);
    expect(background).toContain("#e0eaff");
    expect(background).toContain("#9f50d3");
  });

  it("produces a radial gradient for Voronoi-family presets", () => {
    const descriptor: ShaderDescriptor = {
      preset: "Voronoi",
      params: {},
      colors: ["#ff8247", "#ffe53d"],
    };
    const { background } = buildShaderFillBackground(descriptor);
    expect(background.startsWith("radial-gradient(")).toBe(true);
    expect(background).toContain("#ff8247");
  });

  describe("colour allowlist — no CSS injection reaches the persisted value", () => {
    it("neutralises a declaration/rule breakout payload to a safe colour", () => {
      const descriptor: ShaderDescriptor = {
        preset: "MeshGradient",
        params: {},
        colors: ["#ffffff", "red; } body { display:none"],
      };
      const { background, colors } = buildShaderFillBackground(descriptor);
      // The unsafe entry is replaced with the neutral fallback, never echoed.
      expect(colors).toEqual(["#ffffff", "#808080"]);
      expect(background).not.toContain("display");
      expect(background).not.toContain("}");
      expect(background).not.toContain("{");
      expect(background).not.toContain(";");
    });

    it("neutralises a url() exfiltration payload", () => {
      const descriptor: ShaderDescriptor = {
        preset: "MeshGradient",
        params: {},
        colors: ["#ffffff", "url(http://evil.example/x)"],
      };
      const { background, colors } = buildShaderFillBackground(descriptor);
      expect(colors).toEqual(["#ffffff", "#808080"]);
      expect(background.toLowerCase()).not.toContain("url(");
      expect(background).not.toContain("evil");
    });

    it("rejects a <style> breakout and any angle bracket", () => {
      const descriptor: ShaderDescriptor = {
        preset: "MeshGradient",
        params: {},
        colors: ["</style><script>alert(1)</script>"],
      };
      const { background } = buildShaderFillBackground(descriptor);
      expect(background).not.toContain("<");
      expect(background).not.toContain(">");
      expect(background).not.toContain("script");
    });

    it("preserves valid rgb()/hsl()/named colours verbatim", () => {
      const descriptor: ShaderDescriptor = {
        preset: "MeshGradient",
        params: {},
        colors: ["rgb(255, 0, 0)", "hsl(200, 50%, 50%)", "rebeccapurple"],
      };
      const { colors } = buildShaderFillBackground(descriptor);
      expect(colors).toEqual([
        "rgb(255, 0, 0)",
        "hsl(200, 50%, 50%)",
        "rebeccapurple",
      ]);
    });
  });

  it("the static fallback is a simpler, animation-free linear gradient", () => {
    const descriptor: ShaderDescriptor = {
      preset: "Voronoi",
      params: {},
      colors: ["#ff8247", "#ffe53d"],
    };
    const fallback = generateShaderFillFallbackCss(descriptor);
    expect(fallback.startsWith("linear-gradient(")).toBe(true);
    expect(fallback).toContain("#ff8247");
    expect(fallback).toContain("#ffe53d");
  });
});

// ─── 2. Action contract via source inspection ─────────────────────────────────

describe("apply-shader-fill action contract", () => {
  const actionPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "apply-shader-fill.ts",
  );
  const src = readFileSync(actionPath, "utf8");

  it("asserts editor access before persisting", () => {
    expect(src).toContain('assertAccess("design"');
    expect(src).toMatch(/"editor"/);
  });

  it("scopes the design read with accessFilter", () => {
    expect(src).toContain("accessFilter(schema.designs, schema.designShares)");
  });

  it("validates the descriptor before any write", () => {
    expect(src).toContain("validateDescriptor(descriptor)");
    // Validation in run() must short-circuit before the persist CALL site
    // (`await persistDesignFileEdit(...)`), not merely before the helper def.
    const validateIdx = src.indexOf("validateDescriptor(descriptor)");
    const persistCallIdx = src.indexOf("await persistDesignFileEdit({");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(persistCallIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(persistCallIdx);
  });

  it("persists the fill as a CSS background via the deterministic HTML editor", () => {
    expect(src).toContain("buildShaderFillBackground(descriptor)");
    expect(src).toContain("applyVisualEdit(");
    expect(src).toMatch(/property:\s*"background"/);
  });

  it("only writes HTML design-file sources — other kinds preview, never persist", () => {
    expect(src).toContain('source.kind !== "design-file"');
    expect(src).toMatch(/persisted:\s*false/);
    // The HTML-only guard inside resolveEditableDesignFile.
    expect(src).toContain(
      "Shader fills can only be persisted onto HTML design files",
    );
  });

  it("only persists when the editor actually changed the source", () => {
    expect(src).toMatch(/status === "applied"/);
    expect(src).toMatch(/changed === true/);
  });
});

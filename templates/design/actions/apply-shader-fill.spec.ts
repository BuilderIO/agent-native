import { describe, expect, it } from "vitest";

import {
  buildShaderFillBackground,
  generateShaderFillFallbackCss,
} from "../shared/shader-fill";
import type { ShaderDescriptor } from "../shared/shader-presets";

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

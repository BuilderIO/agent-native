import { describe, expect, it } from "vitest";

import importSvglLogo from "./import-svgl-logo.js";
import logoConfig from "./logo-config.js";
import searchImages from "./search-images.js";
import searchLogos from "./search-logos.js";
import searchSvglLogos from "./search-svgl-logos.js";

describe("Slides media search action surface", () => {
  it("keeps the canonical UI and agent search actions exposed", () => {
    expect(searchImages.http).toEqual({ method: "GET" });
    expect(searchImages.readOnly).toBe(true);
    expect(searchImages.agentTool).not.toBe(false);
    expect(searchLogos.http).toEqual({ method: "GET" });
    expect(searchLogos.readOnly).toBe(true);
    expect(searchLogos.agentTool).not.toBe(false);
    expect(searchSvglLogos.http).toEqual({ method: "GET" });
    expect(searchSvglLogos.readOnly).toBe(true);
    expect(searchSvglLogos.agentTool).not.toBe(false);
    expect(importSvglLogo.agentTool).not.toBe(false);
    expect(importSvglLogo.readOnly).not.toBe(true);
  });

  it("keeps provider configuration HTTP-callable but off the agent surface", () => {
    expect(logoConfig.http).toEqual({ method: "GET" });
    expect(logoConfig.readOnly).toBe(true);
    expect(logoConfig.agentTool).toBe(false);
  });
});

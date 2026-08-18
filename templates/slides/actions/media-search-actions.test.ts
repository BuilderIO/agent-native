import { describe, expect, it } from "vitest";

import logoConfig from "./logo-config.js";
import searchImages from "./search-images.js";
import searchLogos from "./search-logos.js";

describe("Slides media search action surface", () => {
  it("keeps the canonical UI and agent search actions exposed", () => {
    expect(searchImages.http).toEqual({ method: "GET" });
    expect(searchImages.readOnly).toBe(true);
    expect(searchImages.agentTool).not.toBe(false);
    expect(searchLogos.http).toEqual({ method: "GET" });
    expect(searchLogos.readOnly).toBe(true);
    expect(searchLogos.agentTool).not.toBe(false);
  });

  it("keeps provider configuration HTTP-callable but off the agent surface", () => {
    expect(logoConfig.http).toEqual({ method: "GET" });
    expect(logoConfig.readOnly).toBe(true);
    expect(logoConfig.agentTool).toBe(false);
  });
});

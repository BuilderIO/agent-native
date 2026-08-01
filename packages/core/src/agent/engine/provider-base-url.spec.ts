import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_BASE_URL_ENV_VAR,
  baseUrlEnvVarForEngine,
  baseUrlForEngine,
} from "./provider-base-url.js";

describe("baseUrlEnvVarForEngine", () => {
  it("maps both Anthropic engines to ANTHROPIC_BASE_URL", () => {
    expect(baseUrlEnvVarForEngine("anthropic")).toBe(
      ANTHROPIC_BASE_URL_ENV_VAR,
    );
    expect(baseUrlEnvVarForEngine("ai-sdk:anthropic")).toBe(
      ANTHROPIC_BASE_URL_ENV_VAR,
    );
  });

  it("keeps the OpenAI-compatible engine on its own key", () => {
    expect(baseUrlEnvVarForEngine("ai-sdk:openai")).toBe("OPENAI_BASE_URL");
  });

  it("reports no configurable endpoint for engines that have none", () => {
    expect(baseUrlEnvVarForEngine("ai-sdk:google")).toBeUndefined();
    expect(baseUrlEnvVarForEngine("builder")).toBeUndefined();
  });
});

describe("baseUrlForEngine", () => {
  it("gives the official SDK a bare origin from either configured form", () => {
    expect(baseUrlForEngine("anthropic", "http://localhost:4000")).toBe(
      "http://localhost:4000",
    );
    expect(baseUrlForEngine("anthropic", "http://localhost:4000/v1")).toBe(
      "http://localhost:4000",
    );
    expect(baseUrlForEngine("anthropic", "http://localhost:4000/v1/")).toBe(
      "http://localhost:4000",
    );
  });

  it("gives the AI SDK the version segment from either configured form", () => {
    expect(baseUrlForEngine("ai-sdk:anthropic", "http://localhost:4000")).toBe(
      "http://localhost:4000/v1",
    );
    expect(
      baseUrlForEngine("ai-sdk:anthropic", "http://localhost:4000/v1"),
    ).toBe("http://localhost:4000/v1");
  });

  it("preserves a gateway's own path prefix on both engines", () => {
    expect(
      baseUrlForEngine("anthropic", "https://gw.example/anthropic/v1"),
    ).toBe("https://gw.example/anthropic");
    expect(
      baseUrlForEngine("ai-sdk:anthropic", "https://gw.example/anthropic"),
    ).toBe("https://gw.example/anthropic/v1");
  });

  it("leaves other engines' base URLs alone", () => {
    expect(
      baseUrlForEngine("ai-sdk:openai", "https://gateway.example/v1"),
    ).toBe("https://gateway.example/v1");
  });
});

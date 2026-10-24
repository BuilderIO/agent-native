import { describe, expect, it } from "vitest";

import { decisionsConfig } from "./decisions.js";
import { readEnvConfigLayer } from "./env-layer.js";
import { appConfigSchema } from "./schema.js";

describe("decisionsConfig", () => {
  it("defaults customer workspaces to Builder Jev and personal Jev before OpenAI", () => {
    expect(decisionsConfig.parse({}).providerOrder).toEqual(["jev", "openai"]);
  });

  it("allows a workspace to configure OpenAI first", () => {
    expect(
      decisionsConfig.parse({ providerOrder: ["openai", "jev"] }).providerOrder,
    ).toEqual(["openai", "jev"]);
  });

  it("parses a comma-separated provider order from the environment", () => {
    expect(
      readEnvConfigLayer(appConfigSchema, {
        DECISIONS_PROVIDER_ORDER: "openai,jev",
      }),
    ).toMatchObject({ decisions: { providerOrder: ["openai", "jev"] } });
  });
});

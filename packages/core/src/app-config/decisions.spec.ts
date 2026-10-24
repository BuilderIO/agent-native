import { describe, expect, it } from "vitest";

import { decisionsConfig } from "./decisions.js";
import { readEnvConfigLayer } from "./env-layer.js";
import { appConfigSchema } from "./schema.js";

describe("decisionsConfig", () => {
  it("defaults customer workspaces to OpenAI before Jev", () => {
    expect(decisionsConfig.parse({}).providerOrder).toEqual(["openai", "jev"]);
  });

  it("allows a workspace to configure Jev first", () => {
    expect(
      decisionsConfig.parse({ providerOrder: ["jev", "openai"] }).providerOrder,
    ).toEqual(["jev", "openai"]);
  });

  it("parses a comma-separated provider order from the environment", () => {
    expect(
      readEnvConfigLayer(appConfigSchema, {
        DECISIONS_PROVIDER_ORDER: "jev,openai",
      }),
    ).toMatchObject({ decisions: { providerOrder: ["jev", "openai"] } });
  });
});

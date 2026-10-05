import { describe, expect, it } from "vitest";

import {
  AGENT_TROUBLE_CAUSES,
  agentTroubleCauseForCode,
} from "./analytics-events.js";

describe("agent trouble causes", () => {
  it("names the four causes from the codes that detect them", () => {
    expect(AGENT_TROUBLE_CAUSES).toEqual([
      "no_model_connected",
      "rate_limit",
      "context_overflow",
      "provider_error",
    ]);
    expect(agentTroubleCauseForCode("missing_credentials")).toBe(
      "no_model_connected",
    );
    expect(agentTroubleCauseForCode("missing_api_key")).toBe(
      "no_model_connected",
    );
    expect(agentTroubleCauseForCode("AGENT_CHAT_AI_SETUP_REQUIRED")).toBe(
      "no_model_connected",
    );
    for (const code of [
      "rate_limited",
      "rate_limit_exceeded",
      "provider_rate_limited",
      "http_429",
    ]) {
      expect(agentTroubleCauseForCode(code)).toBe("rate_limit");
    }
    expect(agentTroubleCauseForCode("context_length_exceeded")).toBe(
      "context_overflow",
    );
    for (const code of [
      "provider_network_error",
      "provider_config_error",
      "overloaded_error",
      "authentication_error",
      "builder_gateway_internal_error",
      "http_503",
    ]) {
      expect(agentTroubleCauseForCode(code)).toBe("provider_error");
    }
  });

  it("leaves every other code to grouping by code", () => {
    for (const code of [
      undefined,
      "",
      "runtime_error",
      "loop_limit",
      "run_timeout",
      "http_409",
      "http_402",
    ]) {
      expect(agentTroubleCauseForCode(code)).toBeNull();
    }
  });
});

import { describe, expect, it } from "vitest";
import { parseAgentArgs, formatAgentUsage } from "./agent.js";

describe("agent CLI", () => {
  it("parses a positional prompt", () => {
    expect(parseAgentArgs(["Call", "hello"])).toMatchObject({
      prompt: "Call hello",
      json: false,
      errors: [],
    });
  });

  it("parses engine and execution options", () => {
    expect(
      parseAgentArgs([
        "--message",
        "Summarize",
        "--engine=anthropic",
        "--model",
        "claude-test",
        "--soft-timeout-ms",
        "1000",
        "--max-iterations=3",
        "--json",
      ]),
    ).toMatchObject({
      prompt: "Summarize",
      engine: "anthropic",
      model: "claude-test",
      softTimeoutMs: 1000,
      maxIterations: 3,
      json: true,
      errors: [],
    });
  });

  it("reports missing values and includes usage", () => {
    const parsed = parseAgentArgs(["--engine"]);
    expect(parsed.errors).toContain("Missing value for --engine");
    expect(formatAgentUsage()).toContain("agent-native agent");
  });
});

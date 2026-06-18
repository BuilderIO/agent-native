import { describe, expect, it } from "vitest";
import {
  createHeadlessBuiltinActions,
  parseAgentArgs,
  formatAgentUsage,
} from "./agent.js";

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

  it("exposes docs-search to the headless agent loop", async () => {
    const actions = await createHeadlessBuiltinActions();
    const entry = actions["docs-search"];

    expect(entry.readOnly).toBe(true);
    expect(entry.tool.description).toContain("version-matched");

    const result = await entry.run({ slug: "agent-native-docs" });
    expect(result).toContain("node_modules/@agent-native/core/docs");
  });
});

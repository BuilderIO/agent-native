import { describe, expect, it } from "vitest";

import { agentNativeMcpInstructions } from "./agent-mcp-metadata.js";

describe("agentNativeMcpInstructions", () => {
  it("omits the key-tools line when no key tools are given", () => {
    const text = agentNativeMcpInstructions();
    expect(text).not.toContain("Key tools for this app:");
  });

  it("omits the key-tools line for an empty list", () => {
    const text = agentNativeMcpInstructions(undefined, []);
    expect(text).not.toContain("Key tools for this app:");
  });

  it("names the app's key tools once, pointing to tool-search for the rest", () => {
    const text = agentNativeMcpInstructions(undefined, [
      "create-plan",
      "get-plan",
    ]);
    const line =
      "Key tools for this app: create-plan, get-plan. Call tool-search for anything not listed.";
    expect(text.split(line).length - 1).toBe(1);
  });

  it("keeps the key-tools line alongside app-specific guidance", () => {
    const text = agentNativeMcpInstructions("Call view-screen first.", [
      "navigate",
    ]);
    expect(text).toContain("Key tools for this app: navigate.");
    expect(text).toContain("App-specific guidance:\nCall view-screen first.");
  });

  it("names view-screen literally instead of a paraphrase", () => {
    const text = agentNativeMcpInstructions();
    expect(text).toContain("call the app's `view-screen` tool only when");
  });
});

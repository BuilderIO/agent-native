import { describe, it, expect } from "vitest";
import { isBuildAppOrAgentRequest } from "./builder-frame.js";

describe("isBuildAppOrAgentRequest", () => {
  const positives = [
    "build an app",
    "build me an app",
    "Build me an app for tracking sales",
    "build a new app",
    "build me a new app",
    "build a sales tracker app",
    "build me a calendar app for the team",
    "Create an app",
    "create a CRM app",
    "make me an app",
    "make a forms app",
    "scaffold an app",
    "generate a new agent-native app",
    "build a workspace app",
    "build an agent",
    "build me an agent",
    "create an agent",
    "Make me a deck-review agent",
    "scaffold a content agent",
    "generate me an agent for daily standups",
    "I want to build an app",
    "please create an agent",
    "let's build a new app",
    "Build an Agent-Native App",
  ];

  for (const text of positives) {
    it(`matches: "${text}"`, () => {
      expect(isBuildAppOrAgentRequest(text)).toBe(true);
    });
  }

  const negatives = [
    "",
    "hello",
    "what apps do I have?",
    "list my apps",
    "show me the agent that handles slides",
    "remind me to check the build",
    "build me a tool",
    "create a tool",
    "make a sandboxed tool",
    "scaffold a tool",
    "build a recurring job",
    "create a destination",
    "create an automation",
    "build an automation",
    "make a new secret",
    "create a vault secret",
    "build me a Slack message",
    "send an email",
    "open the analytics app",
  ];

  for (const text of negatives) {
    it(`does not match: "${text}"`, () => {
      expect(isBuildAppOrAgentRequest(text)).toBe(false);
    });
  }
});

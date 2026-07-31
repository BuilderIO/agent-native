import { describe, expect, it } from "vitest";

import {
  AGENT_VIEW_SESSION_MS,
  agentKeyFor,
  agentLabelFromUserAgent,
  agentViewSessionId,
} from "./agent-views.js";

describe("agentLabelFromUserAgent", () => {
  it("names known AI agents", () => {
    expect(agentLabelFromUserAgent("Claude-User/1.0")).toBe("Claude");
    expect(
      agentLabelFromUserAgent("Mozilla/5.0 (compatible; GPTBot/1.2)"),
    ).toBe("ChatGPT");
    expect(agentLabelFromUserAgent("PerplexityBot/1.0")).toBe("Perplexity");
  });

  it("returns null for an agent it cannot name", () => {
    expect(agentLabelFromUserAgent("python-requests/2.32")).toBeNull();
    expect(agentLabelFromUserAgent("")).toBeNull();
  });
});

describe("agentViewSessionId", () => {
  const bucketStart =
    Math.floor(1_700_000_000_000 / AGENT_VIEW_SESSION_MS) *
    AGENT_VIEW_SESSION_MS;

  it("collapses one agent's poll burst into a single view", () => {
    expect(agentViewSessionId(bucketStart)).toBe(
      agentViewSessionId(bucketStart + AGENT_VIEW_SESSION_MS - 1),
    );
  });

  it("starts a new view once the window rolls over", () => {
    expect(agentViewSessionId(bucketStart)).not.toBe(
      agentViewSessionId(bucketStart + AGENT_VIEW_SESSION_MS),
    );
  });
});

describe("agentKeyFor", () => {
  it("is stable per agent and separates different agents", () => {
    expect(agentKeyFor("Claude-User/1.0", "1.2.3.4")).toBe(
      agentKeyFor("Claude-User/1.0", "1.2.3.4"),
    );
    expect(agentKeyFor("Claude-User/1.0", "1.2.3.4")).not.toBe(
      agentKeyFor("GPTBot/1.2", "1.2.3.4"),
    );
  });

  it("does not embed the raw IP", () => {
    expect(agentKeyFor("Claude-User/1.0", "1.2.3.4")).not.toContain("1.2.3.4");
  });
});

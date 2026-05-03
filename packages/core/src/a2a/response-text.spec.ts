import { describe, expect, it } from "vitest";
import { collectFinalResponseTextFromAgentEvents } from "./response-text.js";
import type { AgentChatEvent } from "../agent/types.js";

describe("collectFinalResponseTextFromAgentEvents", () => {
  it("returns all text when no tools ran", () => {
    expect(
      collectFinalResponseTextFromAgentEvents([
        { type: "text", text: "Hello " },
        { type: "text", text: "there" },
        { type: "done" },
      ]),
    ).toBe("Hello there");
  });

  it("drops pre-tool narration and keeps the final answer after the last tool", () => {
    const events: AgentChatEvent[] = [
      { type: "text", text: "I will check analytics." },
      { type: "tool_start", tool: "call-agent", input: {} },
      { type: "tool_done", tool: "call-agent", result: "371" },
      { type: "text", text: "371 pageview events yesterday." },
      { type: "done" },
    ];

    expect(collectFinalResponseTextFromAgentEvents(events)).toBe(
      "371 pageview events yesterday.",
    );
  });

  it("uses text after the last tool when several tools ran", () => {
    const events: AgentChatEvent[] = [
      { type: "text", text: "Let me route that." },
      { type: "tool_start", tool: "call-agent", input: {} },
      { type: "tool_done", tool: "call-agent", result: "queued" },
      { type: "text", text: "I have the first result." },
      { type: "tool_start", tool: "create-document", input: {} },
      { type: "tool_done", tool: "create-document", result: "{}" },
      { type: "text", text: "Here is the finished deck URL." },
    ];

    expect(collectFinalResponseTextFromAgentEvents(events)).toBe(
      "Here is the finished deck URL.",
    );
  });

  it("falls back to all text when the post-tool window is empty", () => {
    const events: AgentChatEvent[] = [
      { type: "text", text: "Created it." },
      { type: "tool_start", tool: "create-document", input: {} },
      { type: "tool_done", tool: "create-document", result: "{}" },
      { type: "done" },
    ];

    expect(collectFinalResponseTextFromAgentEvents(events)).toBe("Created it.");
  });
});

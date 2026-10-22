import { describe, expect, it } from "vitest";

import type { ActionCaller, ActionRunContext } from "./action.js";
import { isOutsideAgentCall } from "./outside-agent-call.js";

const callers = {
  frontend: { outside: false, reason: "the app's own UI" },
  tool: { outside: false, reason: "the app's own agent without delegation" },
  http: {
    outside: true,
    reason:
      "HTTP alone does not prove a human UI click; action routes verify UI capability separately",
  },
  cli: {
    outside: true,
    reason:
      "scripts and the development CLI do not prove an in-app human interaction",
  },
  automation: {
    outside: true,
    reason: "scheduled or triggered execution is not an interactive human call",
  },
  mcp: { outside: true, reason: "a direct MCP tool call" },
  a2a: { outside: true, reason: "a direct A2A action call" },
  webmcp: { outside: true, reason: "a browser agent's WebMCP call" },
  "mcp-widget": { outside: true, reason: "a card's scoped read capability" },
  "mcp-widget-write": {
    outside: true,
    reason: "a card's scoped write capability",
  },
} satisfies Record<ActionCaller, { outside: boolean; reason: string }>;

const protocols = {
  a2a: "the default A2A chat handoff retains tool as the caller",
  mcp: "ask_app runs the app agent as tool on an outside agent's behalf",
  "provider-api":
    "external provider provenance does not establish an in-app human call",
} satisfies Record<NonNullable<ActionRunContext["networkProtocol"]>, string>;

describe("isOutsideAgentCall", () => {
  for (const [caller, { outside, reason }] of Object.entries(callers)) {
    const ctx = { caller: caller as ActionCaller };

    it(`classifies ${caller}: ${reason}`, () => {
      expect(isOutsideAgentCall(ctx)).toBe(outside);
    });

    for (const [protocol, reason] of Object.entries(protocols)) {
      it(`treats ${caller} over ${protocol} as outside: ${reason}`, () => {
        expect(
          isOutsideAgentCall({
            ...ctx,
            networkProtocol: protocol as ActionRunContext["networkProtocol"],
          }),
        ).toBe(true);
      });
    }
  }

  it("does not exempt an automation that retains the tool caller", () => {
    expect(
      isOutsideAgentCall({
        caller: "tool",
        automation: { triggerId: "trigger-1", triggerName: "Scheduled run" },
      }),
    ).toBe(true);
  });

  it("fails closed without context or a recognized caller", () => {
    expect(isOutsideAgentCall()).toBe(true);
    expect(isOutsideAgentCall({} as ActionRunContext)).toBe(true);
    expect(
      isOutsideAgentCall({ caller: "future-caller" } as ActionRunContext),
    ).toBe(true);
  });
});

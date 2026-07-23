import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));

import { realDataFinalGuard } from "./agent-chat";

function userMessage(
  text: string,
): AgentLoopFinalResponseGuardContext["messages"][number] {
  return { role: "user", content: [{ type: "text", text }] };
}

function guardContext(params: {
  userText: string;
  draftText: string;
  toolResults?: AgentLoopFinalResponseGuardContext["toolResults"];
}): AgentLoopFinalResponseGuardContext {
  const context: AgentLoopFinalResponseGuardContext & { requestText?: string } =
    {
      messages: [userMessage(params.userText)],
      requestText: params.userText,
      assistantContent: [],
      text: params.draftText,
      toolCalls: [],
      toolResults: params.toolResults ?? [],
      retryCount: 0,
      executionMode: "act",
    };
  return context;
}

describe("realDataFinalGuard dashboard edits", () => {
  it("accepts a dashboard edit that saved a mutation without a data query", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "update the classification logic in both panels to use only DUAL_TRACK and IMPLEMENTATION deals",
        draftText:
          "Updated both panels to use only DUAL_TRACK and IMPLEMENTATION classifications as requested.",
        toolResults: [
          { name: "get-sql-dashboard", isError: false, content: "ok" },
          { name: "mutate-dashboard", isError: false, content: "ok" },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("still retries a dashboard edit whose draft states invented metrics", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "update the classification logic in both panels to use only DUAL_TRACK and IMPLEMENTATION deals",
        draftText:
          "Done. DUAL_TRACK deals now have a 62 percent win rate versus 41 percent for IMPLEMENTATION.",
        toolResults: [
          { name: "get-sql-dashboard", isError: false, content: "ok" },
          { name: "mutate-dashboard", isError: false, content: "ok" },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });
});

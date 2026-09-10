import type { AgentLoopFinalResponseGuardContext } from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../.generated/actions-registry.js", () => ({
  default: {
    bigquery: {
      readOnly: true,
      grounding: true,
      tool: {
        description: "Query BigQuery",
        parameters: { type: "object", properties: {} },
      },
      run: async () => "ok",
    },
  },
}));

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
  it("does not retry a successful dashboard automation as a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create an automation for the Revenue dashboard and run it every morning",
        draftText: 'Created automation "revenue-morning".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "revenue-morning",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not retry a qualified dashboard automation as a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a daily automation for the Revenue dashboard and email it every morning",
        draftText: 'Created automation "revenue-morning".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "revenue-morning",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("keeps dashboard recovery for compound dashboard and automation requests", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a dashboard for the sales team and schedule an automation to email it every morning",
        draftText: 'Created automation "sales-morning".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "sales-morning",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

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

  it("does not treat a skipped compose as a completed dashboard edit", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "refresh the existing dashboard panels",
        draftText: "The dashboard is updated.",
        toolResults: [
          {
            name: "compose-dashboard",
            isError: false,
            content: JSON.stringify({
              saved: true,
              changed: false,
              skippedExistingIds: ["pageviews-over-time"],
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });
});

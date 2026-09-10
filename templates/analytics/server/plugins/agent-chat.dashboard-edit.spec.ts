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

  it("does not retry a dashboard automation compound as a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Build a dashboard automation to email it every morning",
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

    expect(result).toBeNull();

    const nestedResult = realDataFinalGuard(
      guardContext({
        userText:
          "Create a dashboard automation to refresh the Revenue dashboard every morning",
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

    expect(nestedResult).toBeNull();
  });

  it("keeps recovery for an automation-themed dashboard request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Build an automation dashboard tracking Zapier failure rates",
        draftText: 'Created automation "zapier-failures".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "zapier-failures",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("keeps recovery for a separate dashboard beside dashboard automation", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a sales dashboard and a dashboard automation to email it each morning",
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

  it("does not retry a named dashboard-targeting automation as a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a daily lead summary automation for the Sales dashboard",
        draftText: 'Created automation "sales-lead-summary".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "sales-lead-summary",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("keeps recovery for a qualified automation-themed dashboard", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Create a workflow performance dashboard",
        draftText: 'Created automation "workflow-health".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "workflow-health",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("keeps recovery for template-based dashboard construction beside automation", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Use the existing dashboard as a template and update the dashboard automation",
        draftText: 'Updated automation "dashboard-refresh".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              updated: true,
              name: "dashboard-refresh",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("does not retry a nested dashboard action as a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create an automation to refresh the Revenue dashboard every morning",
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

  it("does not retry a template lookup nested inside an automation", () => {
    for (const userText of [
      "Create an automation to clone the Revenue dashboard template every morning",
      "Create an automation using the Revenue dashboard template every morning",
      "Create an automation for the Revenue dashboard using a template",
      "Use the existing dashboard template for an automation",
    ]) {
      const result = realDataFinalGuard(
        guardContext({
          userText,
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
    }
  });

  it("keeps recovery for a long dashboard title with automation", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a quarterly revenue retention forecast dashboard and schedule an automation to email it",
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

    expect(result).not.toBeNull();
  });

  it("keeps recovery for an automation-first dashboard request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Create an automation and a dashboard",
        draftText: 'Created automation "daily-summary".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "daily-summary",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("keeps recovery for a comma-separated dashboard request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Create an automation, build a sales dashboard",
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

  it("keeps recovery for a separate dashboard after nested automation actions", () => {
    for (const userText of [
      "Create an automation to refresh the Revenue dashboard, build a Sales dashboard",
      "Create an automation to refresh the Revenue dashboard and build a Sales dashboard",
    ]) {
      const result = realDataFinalGuard(
        guardContext({
          userText,
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
    }
  });

  it("does not retry bare cron automation as a dashboard build", () => {
    for (const userText of [
      "Create a cron to email the Revenue dashboard daily",
      "Set up cron to refresh the Revenue dashboard daily",
      "Schedule the Revenue dashboard refresh via cron",
      "Refresh the Revenue dashboard via cron every morning",
      "Run the Revenue dashboard refresh on a cron schedule",
      "Schedule a dashboard refresh",
      "Schedule a dashboard refresh every morning",
      "Schedule the dashboard to refresh daily",
      "Schedule a refresh of the Revenue dashboard every morning",
      "Schedule a daily refresh of the dashboard",
      "Could you schedule a dashboard refresh every morning?",
      "Can you schedule the Revenue dashboard to refresh daily?",
      "Create a scheduled refresh of the Revenue dashboard",
      "Configure a scheduled refresh for the Revenue dashboard",
      "Update the Revenue dashboard on a cron schedule",
    ]) {
      const result = realDataFinalGuard(
        guardContext({
          userText,
          draftText: 'Created cron "revenue-morning".',
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
    }
  });

  it("does not steer report-framed refresh-rate queries into dashboard construction", () => {
    for (const userText of [
      "Create a report showing the dashboard refresh rate",
      "What is the refresh rate of the dashboard?",
      "How often does the Revenue dashboard refresh?",
    ]) {
      const result = realDataFinalGuard(
        guardContext({
          userText,
          draftText: "The dashboard refresh rate is 92 percent.",
        }),
      );

      expect(result).not.toBeNull();
      expect(result?.retryMessage).toContain("real source query");
      expect(result?.retryMessage).not.toContain(
        "dashboard construction/template-clone",
      );
    }
  });

  it("keeps dashboard recovery after a comma-then refresh-rate report", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a report showing the dashboard refresh rate, then build a Sales dashboard",
        draftText: "The report is ready.",
      }),
    );

    expect(result?.retryMessage).toContain(
      "dashboard construction/template-clone",
    );
  });

  it("still requires a source query for a refresh-rate report beside a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create a report showing the dashboard refresh rate, then build a Sales dashboard",
        draftText:
          "The dashboard refresh rate is 92 percent and the Sales dashboard is ready.",
      }),
    );

    expect(result?.retryMessage).toContain("real source query");
  });

  it("keeps recovery for an automation dashboard using a template", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Create an automation dashboard using a template",
        draftText: 'Created automation "automation-health".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "automation-health",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("does not retry a dashboard template input as a dashboard build", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Use a dashboard template to create an automation",
        draftText: 'Created automation "template-based".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "template-based",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).toBeNull();
  });

  it("does not retry compound automation actions as a dashboard build", () => {
    for (const userText of [
      "Create an automation to refresh and update the Revenue dashboard",
      "Create a workflow to update, refresh, and rename the Revenue dashboard",
    ]) {
      const result = realDataFinalGuard(
        guardContext({
          userText,
          draftText: 'Created automation "revenue-refresh".',
          toolResults: [
            {
              name: "manage-automations",
              isError: false,
              content: JSON.stringify({
                created: true,
                name: "revenue-refresh",
                triggerType: "schedule",
              }),
            },
          ],
        }),
      );

      expect(result).toBeNull();
    }
  });

  it("keeps recovery for a named dashboard", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText: "Create a dashboard called Automation Health",
        draftText: 'Created automation "automation-health".',
        toolResults: [
          {
            name: "manage-automations",
            isError: false,
            content: JSON.stringify({
              created: true,
              name: "automation-health",
              triggerType: "schedule",
            }),
          },
        ],
      }),
    );

    expect(result).not.toBeNull();
  });

  it("keeps dashboard recovery for a named dashboard and automation request", () => {
    const result = realDataFinalGuard(
      guardContext({
        userText:
          "Create the Revenue dashboard and schedule an automation to email it daily",
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

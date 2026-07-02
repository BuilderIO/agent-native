import { describe, expect, it } from "vitest";

import { loadActionsFromStaticRegistry } from "./action-discovery.js";
import {
  assembleA2AFinalResponse,
  buildPublicAgentA2ASkills,
} from "./agent-chat-plugin.js";

describe("agent-chat A2A public skills", () => {
  it("advertises Brain retrieval actions from the static registry in dev mode", () => {
    const publicAgent = {
      expose: true,
      readOnly: true,
      requiresAuth: false,
      isConsequential: false,
    };
    const actions = loadActionsFromStaticRegistry({
      "search-knowledge": {
        default: {
          tool: {
            description:
              "Search Brain knowledge with SQL text matching over title, summary, and body.",
            parameters: {},
          },
          http: { method: "GET" },
          readOnly: true,
          publicAgent,
          run: async () => ({ knowledge: [] }),
        },
      },
      "search-everything": {
        default: {
          tool: {
            description:
              "Search Brain company memory across published knowledge, accessible raw captures, and accessible source records.",
            parameters: {},
          },
          http: { method: "GET" },
          readOnly: true,
          publicAgent,
          run: async () => ({ results: [] }),
        },
      },
      "write-note": {
        default: {
          tool: { description: "Write a private note.", parameters: {} },
          readOnly: false,
          run: async () => ({ ok: true }),
        },
      },
    });

    const skills = buildPublicAgentA2ASkills(actions);

    expect(skills.map((skill) => skill.id)).toEqual([
      "search-knowledge",
      "search-everything",
    ]);
    expect(skills).toEqual([
      expect.objectContaining({
        id: "search-knowledge",
        description:
          "Search Brain knowledge with SQL text matching over title, summary, and body.",
        publicAgent,
      }),
      expect.objectContaining({
        id: "search-everything",
        description:
          "Search Brain company memory across published knowledge, accessible raw captures, and accessible source records.",
        publicAgent,
      }),
    ]);
  });
});

describe("assembleA2AFinalResponse", () => {
  it("fails terminal agent errors instead of completing with no response", () => {
    expect(() =>
      assembleA2AFinalResponse(
        [
          { type: "clear" },
          {
            type: "error",
            error: "I ran out of time before finishing this step.",
            errorCode: "run_budget_exhausted",
            recoverable: true,
          },
        ],
        [],
      ),
    ).toThrow(/run_budget_exhausted/);
  });

  it("still returns recoverable artifact links from a terminal error run", () => {
    const result = assembleA2AFinalResponse(
      [
        { type: "tool_start", tool: "update-dashboard", input: {} },
        {
          type: "tool_done",
          tool: "update-dashboard",
          result: JSON.stringify({
            id: "growth-funnel",
            name: "Growth Funnel",
            urlPath: "/adhoc/growth-funnel",
          }),
        },
        {
          type: "error",
          error: "The follow-up summary was interrupted.",
          errorCode: "stream_ended",
          recoverable: true,
        },
      ],
      [
        {
          tool: "update-dashboard",
          result: JSON.stringify({
            id: "growth-funnel",
            name: "Growth Funnel",
            urlPath: "/adhoc/growth-funnel",
          }),
        },
      ],
      { baseUrl: "https://analytics.agent.test" },
    );

    expect(result.finalText).toContain(
      'Dashboard "Growth Funnel": https://analytics.agent.test/adhoc/growth-funnel',
    );
  });
});

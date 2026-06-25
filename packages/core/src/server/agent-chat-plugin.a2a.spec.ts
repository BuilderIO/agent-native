import { describe, expect, it } from "vitest";

import { loadActionsFromStaticRegistry } from "./action-discovery.js";
import { buildPublicAgentA2ASkills } from "./agent-chat-plugin.js";

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

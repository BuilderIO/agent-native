import { describe, expect, it } from "vitest";

import { evaluateRecapGate, type RecapGateInput } from "./recap.js";

function validGateInput(
  overrides: Partial<RecapGateInput> = {},
): RecapGateInput {
  return {
    pr: {
      number: 123,
      draft: false,
      author_association: "MEMBER",
      head: { repo: { full_name: "owner/repo" } },
      user: { login: "alice", type: "User" },
      labels: [],
    },
    repository: "owner/repo",
    repositoryPrivate: true,
    hasPlan: true,
    hasAnthropic: true,
    hasOpenai: false,
    hasOpenaiCompatible: false,
    agentRaw: "claude",
    model: undefined,
    baseUrl: undefined,
    skillSource: "auto",
    changedFiles: [],
    ...overrides,
  };
}

describe("evaluateRecapGate", () => {
  it("skips when configured labels are missing", () => {
    const decision = evaluateRecapGate(
      validGateInput({ requiredLabels: "visual recap" }),
    );

    expect(decision.run).toBe(false);
    expect(decision.reasons).toContain(
      "missing required recap label (visual recap)",
    );
  });

  it("runs when the PR has any configured label", () => {
    const decision = evaluateRecapGate(
      validGateInput({
        requiredLabels: "visual recap, expensive",
        pr: {
          number: 123,
          draft: false,
          author_association: "MEMBER",
          head: { repo: { full_name: "owner/repo" } },
          user: { login: "alice", type: "User" },
          labels: [{ name: "Visual Recap" }],
        },
      }),
    );

    expect(decision.run).toBe(true);
    expect(decision.reasons).toEqual([]);
  });
});

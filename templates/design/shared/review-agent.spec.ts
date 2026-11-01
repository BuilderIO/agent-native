import { describe, expect, it } from "vitest";

import {
  isReviewAgentActive,
  REVIEW_AGENT_ACTIONS,
  REVIEW_AGENT_ALLOWED_ACTIONS,
  REVIEW_AGENT_INTENTS,
  REVIEW_AGENT_MODES,
  REVIEW_AGENT_STATUSES,
  type ReviewAgentStatus,
} from "./review-agent";

const TERMINAL_STATUSES: ReviewAgentStatus[] = [
  "replied",
  "suggested",
  "applied",
  "needs-input",
  "failed",
  "cancelled",
];

describe("review agent contract", () => {
  it("offers auto plus the three intents as modes", () => {
    expect(REVIEW_AGENT_MODES).toEqual([
      "auto",
      "reply",
      "suggest",
      "apply-resolve",
    ]);
  });

  it("marks only classifying, queued and running as active", () => {
    expect(REVIEW_AGENT_STATUSES.filter(isReviewAgentActive)).toEqual([
      "classifying",
      "queued",
      "running",
    ]);
  });

  it("puts every status in exactly one of active or terminal", () => {
    const terminal = REVIEW_AGENT_STATUSES.filter(
      (status) => !isReviewAgentActive(status),
    );
    expect([...terminal].sort()).toEqual([...TERMINAL_STATUSES].sort());
  });

  it("keys allowed actions by classification, each intent, and terminal", () => {
    expect(Object.keys(REVIEW_AGENT_ALLOWED_ACTIONS).sort()).toEqual(
      ["classification", "terminal", ...REVIEW_AGENT_INTENTS].sort(),
    );
  });

  it("references only known actions in allowed actions", () => {
    const known: readonly string[] = [
      ...Object.values(REVIEW_AGENT_ACTIONS),
      "get-design-snapshot",
    ];
    for (const actions of Object.values(REVIEW_AGENT_ALLOWED_ACTIONS)) {
      for (const action of actions) {
        expect(known).toContain(action);
      }
    }
  });
});

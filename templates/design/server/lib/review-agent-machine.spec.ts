import { describe, expect, it } from "vitest";

import {
  REVIEW_AGENT_ACTIVE_STATUSES,
  REVIEW_AGENT_STATUSES,
  isReviewAgentActive,
} from "../../shared/review-agent.js";
import { reviewAgentMachine } from "./review-agent-machine.js";

type Event = Parameters<typeof reviewAgentMachine.fromStates>[0];

// Every event's source and target states are pinned here, so a lifecycle
// change is a visible diff in this table and not a silent edit of the machine.
const EVENTS: Record<Event, { from: string[]; to: string }> = {
  classified: { from: ["classifying"], to: "queued" },
  begin: { from: ["queued"], to: "running" },
  reply: { from: ["running"], to: "replied" },
  suggest: { from: ["running"], to: "suggested" },
  apply: { from: ["running"], to: "applied" },
  needInput: { from: ["classifying", "queued", "running"], to: "needs-input" },
  fail: { from: ["classifying", "queued", "running"], to: "failed" },
  cancel: { from: ["classifying", "queued", "running"], to: "cancelled" },
};

describe("review agent request machine", () => {
  it.each(Object.entries(EVENTS))(
    "%s moves %j to the pinned target and nowhere else",
    (event, { from, to }) => {
      const name = event as Event;
      expect([...reviewAgentMachine.fromStates(name)].sort()).toEqual(
        [...from].sort(),
      );
      for (const state of REVIEW_AGENT_STATUSES) {
        if (from.includes(state)) {
          expect(reviewAgentMachine.can(state, name)).toBe(true);
          expect(reviewAgentMachine.transition(state, name)).toBe(to);
        } else {
          expect(reviewAgentMachine.can(state, name)).toBe(false);
        }
      }
    },
  );

  it("covers every event the machine defines", () => {
    expect([...reviewAgentMachine.events].sort()).toEqual(
      Object.keys(EVENTS).sort(),
    );
  });

  it("starts in classifying and agrees with the shared contract's states", () => {
    expect(reviewAgentMachine.initial).toBe("classifying");
    expect([...reviewAgentMachine.states]).toEqual([...REVIEW_AGENT_STATUSES]);
  });

  it("treats exactly the shared active statuses as live", () => {
    for (const state of REVIEW_AGENT_STATUSES) {
      expect(reviewAgentMachine.isTerminal(state)).toBe(
        !isReviewAgentActive(state),
      );
    }
    expect(
      REVIEW_AGENT_STATUSES.filter(
        (state) => !reviewAgentMachine.isTerminal(state),
      ),
    ).toEqual([...REVIEW_AGENT_ACTIVE_STATUSES]);
  });

  it("never moves a finished request again", () => {
    for (const state of REVIEW_AGENT_STATUSES.filter((s) =>
      reviewAgentMachine.isTerminal(s),
    )) {
      for (const event of reviewAgentMachine.events) {
        expect(reviewAgentMachine.can(state, event)).toBe(false);
      }
    }
  });

  it("rejects a stored status it does not know instead of defaulting", () => {
    expect(() => reviewAgentMachine.parseState("resolved")).toThrow();
    expect(reviewAgentMachine.parseState("needs-input")).toBe("needs-input");
  });

  it("can reach every status", () => {
    expect([...reviewAgentMachine.shortestPaths().keys()].sort()).toEqual(
      [...REVIEW_AGENT_STATUSES].sort(),
    );
  });
});

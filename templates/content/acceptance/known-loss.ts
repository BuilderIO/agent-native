import type { TestOptions } from "vitest";

// Main fails these checks today, and the fix belongs to a named lane of the
// stored-form rebuild. CI runs them in a step that reports every run without
// failing the PR. The PR that fixes one drops the marker, which moves the
// check into the required gate; nothing else should remove it.

export const KNOWN_LOSS_TAG = "known-loss";

export type Lane =
  | "L1"
  | "L2"
  | "L3"
  | "L4a"
  | "L4b"
  | "L5a"
  | "L5b"
  | "L6a"
  | "L6b"
  | "L7";

export type OutcomeId =
  | "SF-01"
  | "SF-02"
  | "SF-03"
  | "SF-04"
  | "SF-05"
  | "SF-06"
  | "SF-07"
  | "SF-08"
  | "SF-09"
  | "SF-10"
  | "SF-11"
  | "SF-12";

export interface KnownLoss {
  /** The lane whose fix flips this check, or `unowned` when no lane owns it yet. */
  lane: Lane | readonly Lane[] | "unowned";
  /** The acceptance outcome the failure breaks, when it maps to one. */
  outcome?: OutcomeId;
  /** What main does wrong, in one sentence a lane can verify. */
  reason: string;
}

function lanes(loss: KnownLoss): readonly string[] {
  return typeof loss.lane === "string" ? [loss.lane] : loss.lane;
}

export function describeKnownLoss(loss: KnownLoss): string {
  return `${lanes(loss).join("+")}${loss.outcome ? ` ${loss.outcome}` : ""}: ${loss.reason}`;
}

/** Vitest options: `it("…", knownLossTest({ … }), async () => { … })`. */
export function knownLossTest(loss: KnownLoss): TestOptions {
  // Vitest declares TaskMeta in @vitest/runner, which Content cannot resolve
  // to augment, so the loss rides in meta untyped; reports read meta.knownLoss.
  return {
    tags: [KNOWN_LOSS_TAG],
    meta: { knownLoss: loss } as TestOptions["meta"],
  };
}

/** Playwright details: `test("…", knownLossSpec({ … }), async () => { … })`. */
export function knownLossSpec(loss: KnownLoss) {
  return {
    tag: [
      `@${KNOWN_LOSS_TAG}`,
      ...lanes(loss).map((lane) => `@${lane}`),
      ...(loss.outcome ? [`@${loss.outcome}`] : []),
    ],
    annotation: { type: KNOWN_LOSS_TAG, description: describeKnownLoss(loss) },
  };
}

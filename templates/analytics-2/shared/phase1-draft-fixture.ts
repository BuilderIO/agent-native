export const phase1DraftFixtureKey = Symbol.for(
  "analytics2.phase1.draft-fixture",
);

export type DraftFixtureCell = { projectId: string; cellId: string };
export type DraftFixtureAttempt = DraftFixtureCell & {
  runId: string;
  attemptId: string;
};
export type DraftFixturePhase =
  | "before-dispatch"
  | "before-promotion"
  | "before-candidate-promotion";

export type DraftFixtureBridge = {
  hold(
    attempt: DraftFixtureAttempt,
    phase: DraftFixturePhase,
    signal?: AbortSignal,
  ): Promise<void> | undefined;
  takeIncomplete(cell: DraftFixtureCell): boolean;
};

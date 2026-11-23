import type { JobRunnerResult, SendEmailArgs } from "@agent-native/core/server";

export const phase1ScheduleFixtureKey = Symbol.for(
  "analytics2.phase1.schedule-fixture",
);

export type ScheduledFixtureTick = {
  projectId: string;
  scheduleId: string;
  dueAt: string;
};

export type ScheduleFixtureBridge = {
  now(projectId: string): Date | undefined;
  query(
    tick: ScheduledFixtureTick,
    original: string,
    signal?: AbortSignal,
  ): Promise<string>;
  deliver(
    projectId: string,
    args: SendEmailArgs,
  ): Promise<{ status: "sent"; provider: "resend" }>;
  registerScheduler(scheduler: {
    buildSha: string;
    sweep(input: ScheduledFixtureTick): Promise<JobRunnerResult>;
    settled(input: ScheduledFixtureTick): Promise<boolean>;
  }): void;
};

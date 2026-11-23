import { randomUUID } from "node:crypto";
import { setInterval } from "node:timers/promises";

import { z } from "zod";

import type {
  ScheduleFixtureBridge,
  ScheduledFixtureTick,
} from "../../../shared/phase1-schedule-fixture.js";
import {
  createDraftWorkerControl,
  draftWorkerInput,
} from "./draft-worker-control.js";

const project = z.object({ projectId: z.string().min(1).max(200) });
const schedule = project.extend({ scheduleId: z.uuid() });
const tick = schedule.extend({ dueAt: z.iso.datetime() });
const held = schedule.extend({ holdId: z.uuid() });

const scheduleWorkerInput = z.discriminatedUnion("operation", [
  project
    .extend({ operation: z.literal("schedule-clock"), at: z.iso.datetime() })
    .strict(),
  project.extend({ operation: z.literal("schedule-reset-clock") }).strict(),
  tick
    .extend({ operation: z.literal("schedule-hold-query"), result: z.int() })
    .strict(),
  tick
    .extend({
      operation: z.literal("schedule-fail-query"),
      code: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    })
    .strict(),
  tick.extend({ operation: z.literal("schedule-sweep") }).strict(),
  held.extend({ operation: z.literal("schedule-release-query") }).strict(),
  held.extend({ operation: z.literal("schedule-reset") }).strict(),
]);
export const workerInput = z.discriminatedUnion("operation", [
  draftWorkerInput,
  scheduleWorkerInput,
]);

const tickKey = ({ projectId, scheduleId, dueAt }: ScheduledFixtureTick) =>
  JSON.stringify([projectId, scheduleId, new Date(dueAt).getTime()]);

export function createWorkerControl() {
  const draft = createDraftWorkerControl();
  type Held = {
    input: ScheduledFixtureTick;
    reached: AbortController;
    release: AbortController;
    releasedValue?: number;
    value: number;
  };
  const clocks = new Map<string, string>();
  const holds = new Map<string, Held>();
  const faults = new Map<
    string,
    { tick: ScheduledFixtureTick; code: string }
  >();
  const mail = new Map<
    string,
    { projectId: string; to: string; subject: string }
  >();
  let scheduler:
    | Parameters<ScheduleFixtureBridge["registerScheduler"]>[0]
    | undefined;
  const runner = "analytics2-published-app-schedules";
  function resetQueries(projectId: string, scheduleId?: string) {
    const matches = (scope: ScheduledFixtureTick) =>
      scope.projectId === projectId &&
      (!scheduleId || scope.scheduleId === scheduleId);
    for (const [id, hold] of holds) {
      if (!matches(hold.input)) continue;
      hold.release.abort();
      holds.delete(id);
    }
    for (const [id, { tick }] of faults) if (matches(tick)) faults.delete(id);
  }
  const bridge: ScheduleFixtureBridge = {
    registerScheduler(value) {
      scheduler = value;
    },
    now(projectId) {
      const at = clocks.get(projectId);
      return at ? new Date(at) : undefined;
    },
    async deliver(projectId, { to, subject, idempotencyKey, signal }) {
      signal?.throwIfAborted();
      if (
        !clocks.has(projectId) ||
        !idempotencyKey ||
        !to.endsWith("@local.test")
      )
        throw new Error(
          "The fixture only accepts idempotent email for its local test recipient",
        );
      const previous = mail.get(idempotencyKey);
      if (
        previous &&
        (previous.projectId !== projectId ||
          previous.to !== to ||
          previous.subject !== subject)
      )
        throw new Error(
          "The fixture email idempotency key was reused for a different message",
        );
      mail.set(idempotencyKey, { projectId, to, subject });
      return { status: "sent", provider: "resend" };
    },
    async query(input, original, signal) {
      const key = tickKey(input);
      const fault = faults.get(key);
      if (fault)
        throw Object.assign(new Error(fault.code), {
          name: "Phase1ScheduleQueryError",
        });
      const hold = [...holds.values()].find(
        ({ input }) => tickKey(input) === key,
      );
      if (!hold) return original;
      hold.reached.abort();
      await waitForRelease(hold.release.signal, signal);
      const value = hold.releasedValue;
      return value === undefined ? original : `select ${value} as result`;
    },
  };
  const notReached = () =>
    new Error("The scheduled run did not reach the fixture boundary");
  async function waitUntil(check: () => Promise<boolean>) {
    if (await check()) return;
    const deadline = Date.now() + 10_000;
    for await (const _ of setInterval(100)) {
      if (await check()) return;
      if (Date.now() >= deadline) break;
    }
    throw notReached();
  }
  async function sweep(input: ScheduledFixtureTick, settle: boolean) {
    if (!scheduler)
      throw new Error("The published-app scheduler has not registered");
    const registered = scheduler;
    await waitUntil(async () => {
      const outcome = await registered.sweep(input);
      if (outcome.status !== "success") throw new Error(outcome.reason);
      return !settle || (await registered.settled(input));
    });
    return { workerBuildSha: registered.buildSha, runner, dueAt: input.dueAt };
  }
  async function scheduleControl(input: z.infer<typeof scheduleWorkerInput>) {
    if (!scheduler)
      throw new Error("The published-app scheduler has not registered");
    if (input.operation === "schedule-clock") {
      clocks.set(input.projectId, input.at);
      return { at: input.at, workerBuildSha: scheduler.buildSha, runner };
    }
    if (!clocks.has(input.projectId))
      throw new Error("The project fixture clock has not been set");
    switch (input.operation) {
      case "schedule-reset-clock":
        resetQueries(input.projectId);
        clocks.delete(input.projectId);
        for (const [id, message] of mail)
          if (message.projectId === input.projectId) mail.delete(id);
        return { reset: true };
      case "schedule-hold-query": {
        if (
          [...holds.values()].some(
            (hold) => tickKey(hold.input) === tickKey(input),
          )
        )
          throw new Error("The scheduled query is already held");
        const holdId = randomUUID();
        holds.set(holdId, {
          input,
          reached: new AbortController(),
          release: new AbortController(),
          value: input.result,
        });
        return { holdId };
      }
      case "schedule-fail-query":
        faults.set(tickKey(input), { tick: input, code: input.code });
        return { armed: true };
      case "schedule-sweep":
        return sweep(input, faults.has(tickKey(input)));
      case "schedule-release-query":
      case "schedule-reset": {
        const hold = holds.get(input.holdId);
        if (
          !hold ||
          hold.input.projectId !== input.projectId ||
          hold.input.scheduleId !== input.scheduleId
        )
          throw new Error("Unknown held query for this schedule");
        if (input.operation === "schedule-release-query") {
          await waitForRelease(
            hold.reached.signal,
            AbortSignal.timeout(10_000),
          ).catch(() => {
            throw notReached();
          });
          hold.releasedValue = hold.value;
          hold.release.abort();
          await sweep(hold.input, true);
          return { released: true };
        }
        resetQueries(input.projectId, input.scheduleId);
        return { reset: true };
      }
    }
  }
  async function control(input: z.infer<typeof workerInput>) {
    return "cellId" in input ? draft.control(input) : scheduleControl(input);
  }
  return { bridge, draftBridge: draft.bridge, control };
}

async function waitForRelease(release: AbortSignal, cancelled?: AbortSignal) {
  cancelled?.throwIfAborted();
  if (release.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      cancelled?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      release.removeEventListener("abort", finish);
      reject(cancelled?.reason);
    };
    release.addEventListener("abort", finish, { once: true });
    cancelled?.addEventListener("abort", cancel, { once: true });
  });
}

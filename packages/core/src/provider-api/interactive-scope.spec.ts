import { afterEach, describe, expect, it } from "vitest";

import {
  isChatTurnInteractiveScope,
  isDurableProviderInteractiveScope,
  isProviderInteractiveScope,
  registerBackgroundWorkerProbe,
  runWithDurableTurnToolScope,
  runWithProviderInteractiveScope,
  type ProviderTurnGrant,
} from "./interactive-scope.js";

const grant = (over: Partial<ProviderTurnGrant> = {}): ProviderTurnGrant => ({
  runId: "run-1",
  turnId: "turn-1",
  owner: "Person@Example.test",
  expiresAt: Date.now() + 60_000,
  ...over,
});

afterEach(() => registerBackgroundWorkerProbe(() => false));

describe("provider interactive scope", () => {
  it("does not count work with no ambient scope", () => {
    expect(isProviderInteractiveScope()).toBe(false);
  });

  it("marks work interactive or explicitly not, and revokes the scope when it settles", async () => {
    let leaked: boolean | undefined;
    await runWithProviderInteractiveScope(true, async () => {
      expect(isProviderInteractiveScope()).toBe(true);
      await runWithProviderInteractiveScope(false, () => {
        expect(isProviderInteractiveScope()).toBe(false);
      });
      expect(isProviderInteractiveScope()).toBe(true);
      setTimeout(() => (leaked = isProviderInteractiveScope()), 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(leaked).toBe(false);
  });

  it("only treats an action run as interactive when asked for actionOnly", async () => {
    await runWithProviderInteractiveScope(
      true,
      () => {
        expect(isProviderInteractiveScope(true)).toBe(false);
        expect(isProviderInteractiveScope()).toBe(true);
      },
      { action: false },
    );
  });

  it("does not let an expired chat-turn grant count", async () => {
    await runWithProviderInteractiveScope(
      false,
      () => {
        expect(isChatTurnInteractiveScope()).toBe(false);
        expect(isProviderInteractiveScope()).toBe(false);
      },
      { chatTurnGrant: grant({ expiresAt: Date.now() - 1 }) },
    );
    await runWithProviderInteractiveScope(
      false,
      () => {
        expect(isChatTurnInteractiveScope()).toBe(true);
        expect(isProviderInteractiveScope()).toBe(true);
      },
      { chatTurnGrant: grant() },
    );
  });

  it("lets a background worker count only with a chat-turn grant", async () => {
    registerBackgroundWorkerProbe(() => true);
    expect(isProviderInteractiveScope()).toBe(false);
    await runWithProviderInteractiveScope(
      false,
      () => expect(isProviderInteractiveScope()).toBe(true),
      { chatTurnGrant: grant() },
    );
  });

  it("lets a background worker count as durable-interactive only inside a durable turn grant", async () => {
    registerBackgroundWorkerProbe(() => true);
    expect(isDurableProviderInteractiveScope()).toBe(false);
    await runWithProviderInteractiveScope(
      false,
      async () => {
        const controller = new AbortController();
        await runWithDurableTurnToolScope(
          () => expect(isDurableProviderInteractiveScope()).toBe(true),
          controller.signal,
          { runId: "run-1", turnId: "turn-1", owner: "person@example.test" },
        );
      },
      { turnGrant: grant() },
    );
  });

  it("lets a provider gate's standard predicate see a durable run's own tool call", async () => {
    registerBackgroundWorkerProbe(() => true);
    const controller = new AbortController();
    await runWithProviderInteractiveScope(
      false,
      async () => {
        expect(isProviderInteractiveScope()).toBe(false);
        await runWithDurableTurnToolScope(
          () =>
            // The tool action wraps its run, as `defineAction` does.
            runWithProviderInteractiveScope(true, () => {
              expect(isProviderInteractiveScope(true)).toBe(true);
              expect(isProviderInteractiveScope()).toBe(true);
            }),
          controller.signal,
          { runId: "run-1", turnId: "turn-1", owner: "person@example.test" },
        );
        await runWithDurableTurnToolScope(
          () =>
            runWithProviderInteractiveScope(true, () =>
              expect(isProviderInteractiveScope(true)).toBe(false),
            ),
          controller.signal,
          { runId: "run-2", turnId: "turn-1", owner: "person@example.test" },
        );
      },
      { action: false, turnGrant: grant() },
    );
    await runWithProviderInteractiveScope(true, () =>
      expect(isProviderInteractiveScope(true)).toBe(false),
    );
  });

  it("runs a durable tool call non-interactively when it is not the grant's run, turn or owner, or is unattended", async () => {
    const controller = new AbortController();
    const calls: Array<Parameters<typeof runWithDurableTurnToolScope>[2]> = [
      { runId: "other", turnId: "turn-1", owner: "person@example.test" },
      { runId: "run-1", turnId: "other", owner: "person@example.test" },
      { runId: "run-1", turnId: "turn-1", owner: "someone@else.test" },
      {
        runId: "run-1",
        turnId: "turn-1",
        owner: "person@example.test",
        unattended: true,
      },
      {
        runId: "run-1",
        turnId: "turn-1",
        owner: "person@example.test",
        networkProtocol: "http",
      },
    ];
    await runWithProviderInteractiveScope(
      false,
      async () => {
        for (const binding of calls) {
          await runWithDurableTurnToolScope(
            () => expect(isProviderInteractiveScope()).toBe(false),
            controller.signal,
            binding,
          );
        }
      },
      { turnGrant: grant() },
    );
  });

  it("lets a tool action under an admitted A2A chat turn count in a background worker", async () => {
    registerBackgroundWorkerProbe(() => true);
    const controller = new AbortController();
    await runWithProviderInteractiveScope(
      false,
      () =>
        runWithDurableTurnToolScope(
          () => expect(isProviderInteractiveScope()).toBe(true),
          new AbortController().signal,
          {
            runId: "run-1",
            turnId: "turn-1",
            owner: "person@example.test",
            networkProtocol: "a2a",
          },
        ),
      { action: false, chatTurnGrant: grant(), signal: controller.signal },
    );
  });

  it("revokes an admitted chat turn's grant when its task is canceled", async () => {
    registerBackgroundWorkerProbe(() => true);
    const controller = new AbortController();
    await runWithProviderInteractiveScope(
      false,
      () =>
        runWithDurableTurnToolScope(
          () => {
            expect(isProviderInteractiveScope()).toBe(true);
            controller.abort();
            expect(isProviderInteractiveScope()).toBe(false);
          },
          new AbortController().signal,
          {
            runId: "run-1",
            turnId: "turn-1",
            owner: "person@example.test",
            networkProtocol: "a2a",
          },
        ),
      { action: false, chatTurnGrant: grant(), signal: controller.signal },
    );
  });

  it("revokes a durable tool call's scope when its signal aborts", async () => {
    const controller = new AbortController();
    await runWithProviderInteractiveScope(
      false,
      () =>
        runWithDurableTurnToolScope(
          () => {
            expect(isProviderInteractiveScope()).toBe(true);
            controller.abort();
            expect(isProviderInteractiveScope()).toBe(false);
          },
          controller.signal,
          { runId: "run-1", turnId: "turn-1", owner: "person@example.test" },
        ),
      { turnGrant: grant() },
    );
  });

  it("runs the work unchanged when no ancestor carries a grant", async () => {
    const controller = new AbortController();
    await runWithDurableTurnToolScope(
      () => expect(isProviderInteractiveScope()).toBe(false),
      controller.signal,
      { runId: "run-1", turnId: "turn-1", owner: "person@example.test" },
    );
  });

  it("keeps a returned stream's scope alive until it ends, then revokes it", async () => {
    const seen: boolean[] = [];
    const stream = await runWithProviderInteractiveScope(true, () => {
      let n = 0;
      return new ReadableStream<number>({
        pull(controller) {
          seen.push(isProviderInteractiveScope());
          if (n++ < 2) controller.enqueue(n);
          else controller.close();
        },
      });
    });
    const reader = stream.getReader();
    while (!(await reader.read()).done);
    expect(seen.every(Boolean)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });
});

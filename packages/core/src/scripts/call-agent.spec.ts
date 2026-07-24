import { beforeEach, describe, expect, it, vi } from "vitest";

const callAgentMock = vi.hoisted(() => vi.fn());
const invokeActionMock = vi.hoisted(() => vi.fn());
const insertA2AContinuationMock = vi.hoisted(() => vi.fn());
const dispatchA2AContinuationMock = vi.hoisted(() => vi.fn());
const bumpRunProgressMock = vi.hoisted(() => vi.fn(async () => {}));
const integrationRequestContextMock = vi.hoisted(() => vi.fn());

const slackIntegrationContext = {
  taskId: "integration-task-1",
  attempts: 1,
  incoming: {
    platform: "slack",
    externalThreadId: "C123:123.456",
    text: "make a deck",
    sourceUrl: "https://example-workspace.slack.com/archives/C123/p123456",
    platformContext: {},
    timestamp: 123,
  },
  placeholderRef: "placeholder-1",
  progressRef: { kind: "slack-stream", streamTs: "1719000000.000001" },
};

vi.mock("../server/agent-discovery.js", () => ({
  findAgent: vi.fn(async () => ({
    name: "Slides",
    url: "https://slides.agent-native.test",
  })),
  discoverAgents: vi.fn(async () => []),
}));

vi.mock("../a2a/client.js", () => ({
  A2ATaskTimeoutError: class A2ATaskTimeoutError extends Error {
    taskId: string;
    constructor(taskId: string) {
      super(`A2A task ${taskId} did not complete within 18000ms`);
      this.name = "A2ATaskTimeoutError";
      this.taskId = taskId;
    }
  },
  callAction: invokeActionMock,
  callAgent: callAgentMock,
  shouldPreferGlobalA2ASecret: (orgSecret?: string) =>
    !!process.env.A2A_SECRET?.trim() || !orgSecret,
  signA2AToken: vi.fn(async () => "signed-token"),
}));

vi.mock("../org/context.js", () => ({
  getOrgDomain: vi.fn(async () => "builder.io"),
  getOrgA2ASecret: vi.fn(async () => "org-secret"),
}));

vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => "alice+qa@agent-native.test",
  getRequestOrgId: () => "org-qa",
  isIntegrationCallerRequest: () => true,
  getIntegrationRequestContext: integrationRequestContextMock,
}));

vi.mock("../integrations/a2a-continuations-store.js", () => ({
  insertA2AContinuation: insertA2AContinuationMock,
  getA2AContinuationsForIntegrationTaskAgent: vi.fn(async () => []),
}));

vi.mock("../integrations/a2a-continuation-processor.js", () => ({
  dispatchA2AContinuation: dispatchA2AContinuationMock,
}));

// Full mock of run-store.js so the real run-manager.js can be imported and
// driven end-to-end in the "progress heartbeat" tests below (see that
// describe block for why: shouldBumpProgressForEvent, the predicate that
// decides whether an event counts as real progress, is an unexported closure
// inside run-manager.ts's startRun(), so the only faithful way to assert
// against the REAL predicate — not a reimplemented copy — is to run a real
// managed run and observe whether the mocked bumpRunProgress gets called.
// This mirrors the mock shape in agent/run-manager.spec.ts.
vi.mock("../agent/run-store.js", () => ({
  insertRun: vi.fn(() => Promise.resolve()),
  insertRunEvent: vi.fn(() => Promise.resolve()),
  updateRunStatus: vi.fn(() => Promise.resolve()),
  updateRunStatusIfRunning: vi.fn(() => Promise.resolve(true)),
  getRunStatus: vi.fn(() => Promise.resolve("running")),
  tryClaimRunSlot: vi.fn(() =>
    Promise.resolve({ claimed: true, activeRunId: null }),
  ),
  markRunAborted: vi.fn(() => Promise.resolve()),
  isRunAborted: vi.fn(() => Promise.resolve(false)),
  getRunAbortState: vi.fn(() => Promise.resolve({ aborted: false })),
  getRunEventsSince: vi.fn(() => Promise.resolve([])),
  getRunById: vi.fn(() => Promise.resolve(null)),
  getRunByThread: vi.fn(() => Promise.resolve(null)),
  cleanupOldRuns: vi.fn(() => Promise.resolve()),
  updateRunHeartbeat: vi.fn(() => Promise.resolve()),
  bumpRunProgress: bumpRunProgressMock,
  setRunInFlightMarker: vi.fn(() => Promise.resolve()),
  reapIfStale: vi.fn(() => Promise.resolve(null)),
  reapUnclaimedBackgroundRun: vi.fn(() => Promise.resolve(false)),
  UNCLAIMED_BACKGROUND_RUN_REDISPATCH_BOUND_MS: 5 * 60_000,
  shouldRedispatchUnclaimedBackgroundRun: (
    row: { startedAt: number },
    now: number = Date.now(),
  ) => now - row.startedAt < 5 * 60_000,
  reconcileTerminalRunFromEvents: vi.fn(() => Promise.resolve(false)),
  ensureTerminalRunEvent: vi.fn(() => Promise.resolve()),
  getLastTerminalRunEvent: vi.fn(() => Promise.resolve(null)),
  resolveErroredRunTerminalEvent: vi.fn(() => ({
    event: {
      type: "error",
      error: "The agent stopped before it could finish.",
      errorCode: "stale_run",
      recoverable: true,
    },
    shouldPersist: true,
  })),
  setRunError: vi.fn(() => Promise.resolve()),
  setRunTerminalReason: vi.fn(() => Promise.resolve()),
  STALE_RUN_ERROR_EVENT: {
    type: "error",
    error: "The agent stopped before it could finish.",
    errorCode: "stale_run",
    recoverable: true,
  },
}));

describe("call-agent action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NETLIFY;
    integrationRequestContextMock.mockReturnValue(slackIntegrationContext);
    insertA2AContinuationMock.mockResolvedValue({ id: "cont-1" });
    dispatchA2AContinuationMock.mockResolvedValue(undefined);
  });

  it("forwards the user's exact downstream action authorization", async () => {
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");
    const approvedActions = [
      { tool: "send-email", input: { to: "alice@example.test" } },
    ];

    await run({
      agent: "mail",
      message: "send it",
      approvedActions,
    });

    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.stringContaining("send it"),
      expect.objectContaining({ approvedActions }),
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain(
      "Return a concise caller-ready synthesis rather than raw tool output or full transcripts",
    );
  });

  it("forwards Slack source context as structured A2A data", async () => {
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");

    await run({ agent: "content", message: "capture this request" });

    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.not.stringContaining("Verified source context"),
      expect.objectContaining({
        sourceContext: {
          platform: "slack",
          integrationTaskId: "integration-task-1",
        },
      }),
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain(
      "Source Slack thread: https://example-workspace.slack.com/archives/C123/p123456",
    );
    expect(callAgentMock.mock.calls[0]?.[1]).toContain(
      "this text is not authoritative",
    );
  });

  it.each([
    {
      label: "non-Slack source",
      context: {
        ...slackIntegrationContext,
        incoming: {
          ...slackIntegrationContext.incoming,
          platform: "email",
          sourceUrl: "https://example.test/thread/123",
        },
      },
    },
    {
      label: "malformed Slack source URL",
      context: {
        ...slackIntegrationContext,
        incoming: {
          ...slackIntegrationContext.incoming,
          sourceUrl: "not a URL",
        },
      },
    },
    {
      label: "whitespace-padded Slack source URL",
      context: {
        ...slackIntegrationContext,
        incoming: {
          ...slackIntegrationContext.incoming,
          sourceUrl:
            " https://example-workspace.slack.com/archives/C123/p123456 ",
        },
      },
    },
  ])("does not forward Slack provenance for $label", async ({ context }) => {
    integrationRequestContextMock.mockReturnValue(context);
    callAgentMock.mockResolvedValueOnce("sent");
    const { run } = await import("./call-agent.js");

    await run({ agent: "content", message: "capture this request" });

    expect(callAgentMock.mock.calls[0]?.[1]).not.toContain(
      "Verified source context",
    );
    expect(callAgentMock.mock.calls[0]?.[1]).not.toContain(
      "Source Slack thread",
    );
    expect(callAgentMock.mock.calls[0]?.[2]).not.toHaveProperty(
      "sourceContext",
    );
  });

  it("propagates caller lineage and a deterministic per-turn message key", async () => {
    callAgentMock.mockResolvedValue("done");
    const { run } = await import("./call-agent.js");
    const context = {
      send: vi.fn(),
      threadId: "thread-qa",
      runId: "run-qa",
      turnId: "turn-qa",
    } as any;

    await run({ agent: "slides", message: "exact message" }, context, "mail");
    await run({ agent: "slides", message: "exact message" }, context, "mail");
    await run(
      { agent: "slides", message: "exact message changed" },
      context,
      "mail",
    );

    const firstOptions = callAgentMock.mock.calls[0]?.[2];
    const duplicateOptions = callAgentMock.mock.calls[1]?.[2];
    const changedOptions = callAgentMock.mock.calls[2]?.[2];
    expect(firstOptions).toMatchObject({
      contextId: "thread-qa",
      correlation: {
        callerApp: "mail",
        callerThreadId: "thread-qa",
        parentRunId: "run-qa",
        parentTurnId: "turn-qa",
      },
      idempotencyKey: expect.stringMatching(/^v1:[a-f0-9]{64}$/),
    });
    expect(duplicateOptions.idempotencyKey).toBe(firstOptions.idempotencyKey);
    expect(changedOptions.idempotencyKey).not.toBe(firstOptions.idempotencyKey);
  });

  it("polls a returned task id without sending another downstream message", async () => {
    callAgentMock.mockResolvedValueOnce("finished once");
    const { run, tool } = await import("./call-agent.js");

    const result = await run({
      agent: "analytics",
      taskId: "remote-task-1",
    });

    expect(result).toBe("finished once");
    expect(tool.parameters.required).toEqual(["agent"]);
    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "",
      expect.objectContaining({
        taskId: "remote-task-1",
        returnRecoverableArtifactsOnTimeout: false,
      }),
    );
  });

  it("directly invokes an exposed read-only action without calling the remote agent", async () => {
    invokeActionMock.mockResolvedValueOnce({
      action: "gong-calls",
      status: "completed",
      output: '{"total":13}',
    });
    const { run } = await import("./call-agent.js");
    const send = vi.fn();

    const result = await run(
      {
        agent: "analytics",
        action: "gong-calls",
        input: { company: "Edmunds", days: 90 },
      },
      {
        send,
        threadId: "thread-qa",
        runId: "run-qa",
        turnId: "turn-qa",
      } as any,
      "mail",
    );

    expect(result).toBe('{"total":13}');
    expect(invokeActionMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      "gong-calls",
      { company: "Edmunds", days: 90 },
      expect.objectContaining({
        userEmail: "alice+qa@agent-native.test",
        orgDomain: "builder.io",
        orgSecret: "org-secret",
        correlation: {
          callerApp: "mail",
          callerThreadId: "thread-qa",
          parentRunId: "run-qa",
          parentTurnId: "turn-qa",
          invocationId: expect.any(String),
        },
      }),
    );
    expect(callAgentMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call_text",
        agent: "Slides",
        text: '{"total":13}',
        agentCallId: expect.any(String),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call",
        agent: "Slides",
        status: "start",
        agentCallId: expect.any(String),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call",
        agent: "Slides",
        status: "done",
        agentCallId: expect.any(String),
        durationMs: expect.any(Number),
      }),
    );
  });

  it("tells the model to keep polling the same task after a bounded wait", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    insertA2AContinuationMock.mockRejectedValueOnce(
      new Error("continuations unavailable"),
    );
    const timeout = Object.assign(
      new Error(
        "A2A task remote-task-keep did not complete within 300000ms (last state: working)",
      ),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-keep",
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "analytics", message: "review all calls" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain('taskId "remote-task-keep"');
    expect(result).toContain(
      'taskId="remote-task-keep" (omit message) to continue waiting',
    );
    expect(result).toContain("Do not send Slides a new check-in");
    consoleError.mockRestore();
  });

  it("queues an integration continuation for structurally equivalent timeout errors", async () => {
    process.env.NETLIFY = "true";
    const timeout = Object.assign(
      new Error(
        "A2A task remote-task-1 did not complete within 18000ms (last state: processing)",
      ),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-1",
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "slides", message: "create the QA deck" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain("[agent-native:a2a-continuation-queued]");
    expect(insertA2AContinuationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationTaskId: "integration-task-1",
        agentName: "Slides",
        agentUrl: "https://slides.agent-native.test",
        a2aTaskId: "remote-task-1",
        dedupeKey: expect.any(String),
        progressRef: {
          kind: "slack-stream",
          streamTs: "1719000000.000001",
        },
      }),
    );
    expect(dispatchA2AContinuationMock).toHaveBeenCalledWith("cont-1");
    expect(callAgentMock).toHaveBeenCalledWith(
      "https://slides.agent-native.test",
      expect.stringContaining(
        "Source Slack thread: https://example-workspace.slack.com/archives/C123/p123456",
      ),
      expect.any(Object),
    );
  });

  it("returns receiver-verified artifacts when continuation enqueue fails", async () => {
    process.env.NETLIFY = "true";
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    insertA2AContinuationMock.mockRejectedValueOnce(
      new Error("database temporarily unavailable"),
    );
    const timeout = Object.assign(
      new Error("A2A task remote-task-artifact did not complete within 2000ms"),
      {
        name: "A2ATaskTimeoutError",
        taskId: "remote-task-artifact",
        lastTask: {
          id: "remote-task-artifact",
          status: {
            state: "working",
            timestamp: "",
            message: {
              role: "agent",
              metadata: { agentNativeRecoverableArtifacts: true },
              parts: [
                {
                  type: "text",
                  text: "Artifacts:\n- Deck: /deck/deck-real (ID: deck-real)",
                },
              ],
            },
          },
        },
      },
    );
    callAgentMock.mockRejectedValueOnce(timeout);
    const { run } = await import("./call-agent.js");

    const result = await run(
      { agent: "slides", message: "create the QA deck" },
      { send: vi.fn() } as any,
    );

    expect(result).toContain("https://slides.agent-native.test/deck/deck-real");
    expect(result).not.toContain("[agent-native:a2a-continuation-queued]");
    expect(dispatchA2AContinuationMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe("poll-driven progress", () => {
    // Minimal A2A Task shaped like what callAgent()'s poll passes to onUpdate.
    const makeTask = (
      state: string,
      detailText?: string,
      parts: unknown[] = [],
    ): any => ({
      id: "task-1",
      status: {
        state,
        timestamp: "",
        ...(detailText || parts.length
          ? {
              message: {
                role: "agent",
                parts: [
                  ...parts,
                  ...(detailText ? [{ type: "text", text: detailText }] : []),
                ],
              },
            }
          : {}),
      },
    });

    it("emits no progress events when the call resolves immediately (onUpdate never fires)", async () => {
      callAgentMock.mockResolvedValueOnce("All done");
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      const result = await run({ agent: "slides", message: "quick question" }, {
        send,
      } as any);

      expect(result).toBe("All done");
      const events = send.mock.calls.map(([event]) => event);
      expect(
        events.filter((e: any) => e.type === "agent_call_progress"),
      ).toHaveLength(0);
      // The normal start/done bracket still fires unchanged.
      expect(events).toContainEqual(
        expect.objectContaining({ type: "agent_call", status: "start" }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: "agent_call", status: "done" }),
      );
    });

    it("throttles progress to ~one per 30s over a long poll that round-trips every 2s", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((res) => {
            resolveCall = res;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const p = run({ agent: "slides", message: "long task" }, {
          send,
        } as any);

        // Flush setup awaits (findAgent, org lookups, token signing) until
        // callAgent has been invoked and registered onUpdate.
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        // 40 successful poll round-trips at 2s each = 80s of live remote work.
        for (let i = 0; i < 40; i++) {
          await vi.advanceTimersByTimeAsync(2_000);
          onUpdate!(makeTask("working", "Generating slides…"));
        }
        resolveCall!("final answer");
        await p;

        const progress = send.mock.calls
          .map(([e]) => e)
          .filter((e: any) => e.type === "agent_call_progress");
        // 80s under a 30s throttle -> ticks at ~30s and ~60s only.
        expect(progress.length).toBeGreaterThanOrEqual(2);
        expect(progress.length).toBeLessThanOrEqual(3);
        // Emphatically NOT one-per-poll: far fewer than the 40 round-trips.
        expect(progress.length).toBeLessThan(10);
        // Carries the real remote state and surfaced detail, not a bare tick.
        expect(progress[0]).toMatchObject({
          type: "agent_call_progress",
          agent: "Slides",
          state: "working",
          detail: "Generating slides…",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats a claimed processing task as active remote progress", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((resolve) => {
            resolveCall = resolve;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const pending = run({ agent: "slides", message: "long claimed task" }, {
          send,
        } as any);
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        await vi.advanceTimersByTimeAsync(30_000);
        onUpdate!(makeTask("processing", "Rendering the deck…"));
        resolveCall!("final answer");
        await pending;

        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "agent_call_progress",
            agent: "Slides",
            state: "processing",
            elapsedSeconds: 30,
            detail: "Rendering the deck…",
            agentCallId: expect.any(String),
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits agent_call_progress events the REAL run-manager progress predicate (not a copy) counts as progress", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((res) => {
            resolveCall = res;
          });
        });

        const { run: callAgentAction } = await import("./call-agent.js");
        const { startRun } = await import("../agent/run-manager.js");

        // shouldBumpProgressForEvent is an unexported closure inside
        // startRun(); the only faithful way to assert against the REAL
        // predicate is to run a real managed run and observe whether the
        // (mocked) bumpRunProgress fires. softTimeoutMs:0 keeps the run from
        // auto-continuing during our time advances.
        const managedRun = startRun(
          "run-progress-1",
          "thread-progress-1",
          async (send) => {
            await callAgentAction(
              { agent: "slides", message: "build the deck" },
              { send } as any,
            );
          },
          undefined,
          { softTimeoutMs: 0 },
        );
        managedRun.subscribers.add(() => {});

        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        // Two well-spaced successful polls -> two emitted progress events.
        await vi.advanceTimersByTimeAsync(30_000);
        onUpdate!(makeTask("working"));
        await vi.advanceTimersByTimeAsync(30_000);
        onUpdate!(makeTask("working"));
        await vi.advanceTimersByTimeAsync(2_000);
        resolveCall!("final");
        await vi.advanceTimersByTimeAsync(2_000);

        // start + 2 progress + done = 4 events. A start+done-only run (zero
        // progress) can bump at most twice, so >=4 proves the two
        // agent_call_progress events themselves moved last_progress_at.
        expect(bumpRunProgressMock.mock.calls.length).toBeGreaterThanOrEqual(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it("emits NOTHING when the remote hangs so the stuck-detector can still fire (onUpdate never called)", async () => {
      // Remote is unresponsive: callAgent's poll fetch keeps throwing, so the
      // client never invokes onUpdate. callAgent ultimately returns a
      // took-too-long message. The regression this guards: a wall-clock
      // heartbeat would keep emitting progress here and mask the hang.
      callAgentMock.mockImplementation(async (_url, _msg, opts) => {
        expect(typeof opts.onUpdate).toBe("function");
        return "The Slides agent is taking longer than expected and didn't reply in time.";
      });
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      await run({ agent: "slides", message: "x" }, { send } as any);

      const events = send.mock.calls.map(([e]) => e);
      expect(
        events.filter((e: any) => e.type === "agent_call_progress"),
      ).toHaveLength(0);
      // The call still bracketed start/done so the parent knows it ran.
      expect(events).toContainEqual(
        expect.objectContaining({ type: "agent_call", status: "start" }),
      );
    });

    it("emits each newer remote activity snapshot once", async () => {
      let onUpdate: ((task: any) => void) | undefined;
      let resolveCall: ((value: string) => void) | undefined;
      callAgentMock.mockImplementation((_url, _msg, opts) => {
        onUpdate = opts.onUpdate;
        return new Promise<string>((resolve) => {
          resolveCall = resolve;
        });
      });

      const { run } = await import("./call-agent.js");
      const send = vi.fn();
      const pending = run({ agent: "slides", message: "build the deck" }, {
        send,
      } as any);
      while (!onUpdate) await Promise.resolve();

      const activityPart = (sequence: number) => ({
        type: "data",
        data: {
          kind: "agent-native/agent-activity",
          version: 1,
          sequence,
          startedAt: 1_000,
          updatedAt: 1_000 + sequence,
          durationMs: sequence,
          activePhase: "tool",
          reasoning: [],
          toolCalls: [{ id: "search-1", name: "search", status: "running" }],
        },
      });

      onUpdate!(makeTask("working", undefined, [activityPart(1)]));
      onUpdate!(makeTask("working", undefined, [activityPart(1)]));
      onUpdate!(makeTask("working", undefined, [activityPart(2)]));
      resolveCall!("finished");
      await pending;

      const activityEvents = send.mock.calls
        .map(([event]) => event)
        .filter((event: any) => event.type === "agent_call_activity");
      expect(
        activityEvents.map((event: any) => event.snapshot.sequence),
      ).toEqual([1, 2]);
    });

    it("emits NOTHING when the remote poll throws (getTask rejects)", async () => {
      callAgentMock.mockRejectedValueOnce(new Error("fetch failed"));
      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      await run({ agent: "slides", message: "x" }, { send } as any);

      const events = send.mock.calls.map(([e]) => e);
      expect(
        events.filter((e: any) => e.type === "agent_call_progress"),
      ).toHaveLength(0);
    });

    it("does not emit progress for a terminal-state poll even with the throttle window open", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _msg, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((res) => {
            resolveCall = res;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const p = run({ agent: "slides", message: "x" }, { send } as any);
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);

        // Advance well past the 30s throttle so a working state WOULD emit —
        // proving it's the terminal-state gate, not the throttle, suppressing.
        await vi.advanceTimersByTimeAsync(40_000);
        onUpdate!(makeTask("completed"));
        resolveCall!("done");
        await p;

        const progress = send.mock.calls
          .map(([e]) => e)
          .filter((e: any) => e.type === "agent_call_progress");
        expect(progress).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("allows a terminal poll update without message parts to complete", async () => {
      callAgentMock.mockImplementation(async (_url, _message, opts) => {
        opts.onUpdate({
          id: "task-1",
          status: {
            state: "completed",
            timestamp: "",
            message: { role: "agent" },
          },
        });
        return "terminal answer";
      });

      const { run } = await import("./call-agent.js");
      const send = vi.fn();

      const result = await run({ agent: "slides", message: "x" }, {
        send,
      } as any);

      expect(result).toBe("terminal answer");
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "agent_call",
          agent: "Slides",
          status: "done",
        }),
      );
    });

    it("allows a working poll update with non-array message parts", async () => {
      vi.useFakeTimers();
      try {
        let onUpdate: ((task: any) => void) | undefined;
        let resolveCall: ((value: string) => void) | undefined;
        callAgentMock.mockImplementation((_url, _message, opts) => {
          onUpdate = opts.onUpdate;
          return new Promise<string>((resolve) => {
            resolveCall = resolve;
          });
        });

        const { run } = await import("./call-agent.js");
        const send = vi.fn();
        const pending = run({ agent: "slides", message: "x" }, {
          send,
        } as any);
        while (!onUpdate) await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(40_000);

        expect(() =>
          onUpdate!({
            id: "task-1",
            status: {
              state: "working",
              timestamp: "",
              message: { role: "agent", parts: {} },
            },
          }),
        ).not.toThrow();
        resolveCall!("terminal answer");
        await pending;

        expect(
          send.mock.calls
            .map(([event]) => event)
            .find((event: any) => event.type === "agent_call_progress"),
        ).toEqual(
          expect.objectContaining({
            type: "agent_call_progress",
            state: "working",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("threads onUpdate through and leaves the integration-caller timeout cap unchanged", async () => {
      process.env.NETLIFY = "true";
      callAgentMock.mockResolvedValueOnce("Handled");
      const { run } = await import("./call-agent.js");

      await run({ agent: "slides", message: "quick integration question" }, {
        send: vi.fn(),
      } as any);

      // NETLIFY_INTEGRATION_A2A_TIMEOUT_MS unchanged; onUpdate now threaded.
      expect(callAgentMock).toHaveBeenCalledWith(
        "https://slides.agent-native.test",
        expect.any(String),
        expect.objectContaining({
          timeoutMs: 2_000,
          onUpdate: expect.any(Function),
          returnRecoverableArtifactsOnTimeout: false,
        }),
      );
    });
  });
});

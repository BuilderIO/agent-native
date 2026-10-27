// @vitest-environment happy-dom

import { AgentKitClient as AgentKitClientImplementation } from "@agent-native/agentkit/client";
import type {
  AgentError,
  AgentEvent,
  AgentThreadSnapshot,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerRuntimeAdaptersProvider } from "../../../composer/runtime-adapters.js";
import { AgentKitChat } from "./components.js";
import { AgentKitProvider } from "./context.js";

class AgentKitClient extends AgentKitClientImplementation {
  constructor(
    options: ConstructorParameters<typeof AgentKitClientImplementation>[0],
  ) {
    super({
      ...options,
      aiSetupReadiness: "not-applicable",
      reconnect: { attempts: 0, delayMs: 0 },
    });
  }
}

const AT = "2026-10-23T00:00:00.000Z";

const threadIdOf = (input: unknown) =>
  typeof input === "string" ? input : (input as { threadId: string }).threadId;

function runEvents(
  threadId: string,
  runId: string,
  terminal?: { type: "run.failed"; error: AgentError },
): AgentEvent[] {
  const types = [
    { type: "run.started" },
    { type: "run.status", status: "running" },
    ...(terminal ? [terminal] : []),
  ];
  return types.map(
    (payload, index) =>
      ({
        id: `${runId}:e${index + 1}`,
        threadId,
        runId,
        sequence: index + 1,
        occurredAt: AT,
        ...payload,
      }) as unknown as AgentEvent,
  );
}

function snapshot(
  threadId: string,
  run: { status: "running" | "failed"; error?: AgentError },
): AgentThreadSnapshot {
  const runId = `run-${threadId}`;
  const events = runEvents(
    threadId,
    runId,
    run.status === "failed" && run.error
      ? { type: "run.failed", error: run.error }
      : undefined,
  );
  return {
    id: threadId,
    createdAt: AT,
    updatedAt: AT,
    messages: [
      {
        id: `user-${threadId}`,
        role: "user",
        createdAt: AT,
        parts: [{ type: "text", text: "Summarize the release notes." }],
      },
    ],
    events,
    runs: [
      {
        id: runId,
        threadId,
        status: run.status,
        lastSequence: events.length,
        startedAt: AT,
        ...(run.status === "failed"
          ? { completedAt: AT, error: run.error }
          : {}),
      },
    ],
    activeRunIds: run.status === "running" ? [runId] : [],
  } as AgentThreadSnapshot;
}

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  vi.unstubAllGlobals();
});

async function mount(
  client: AgentKitClient,
  render: (threadId: string) => ReactNode,
  threadId: string,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const tree = (id: string) => (
    <ComposerRuntimeAdaptersProvider
      adapters={{
        models: {
          useAgentEngineConfigured: () => ({
            missing: false,
            state: "configured",
          }),
          fetchAgentEngineConfiguredState: async () => "configured",
        },
      }}
    >
      <AgentKitProvider controller={client} threadId={id}>
        {render(id)}
      </AgentKitProvider>
    </ComposerRuntimeAdaptersProvider>
  );
  await act(async () => {
    root.render(tree(threadId));
    await Promise.resolve();
  });
  mounted.push(async () => {
    await act(async () => root.unmount());
    await client.shutdown();
    container.remove();
  });
  return {
    container,
    rerender: async (id: string) => {
      await act(async () => {
        root.render(tree(id));
        await Promise.resolve();
      });
    },
  };
}

const notices = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>("[data-agent-composer-notice]"),
];

async function lostConnection(threadIds: string[] = ["thread-lost"]) {
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "run-new" };
    },
    async *subscribeToRun() {
      throw Object.assign(new Error("Connection to the agent was lost."), {
        code: "network_error",
        retryable: true,
      });
    },
    async cancelRun() {},
    async getThreadSnapshot(input) {
      return snapshot(threadIdOf(input), { status: "running" });
    },
  };
  const client = new AgentKitClient({ transport });
  for (const threadId of threadIds) await client.loadThread(threadId);
  await client
    .resubscribeRun(threadIds[0]!, `run-${threadIds[0]}`)
    .catch(() => undefined);
  return client;
}

describe("AgentKit recoverable failure notices", () => {
  it("shows a lost connection once, as an amber notice above the input", async () => {
    const client = await lostConnection();
    const { container } = await mount(
      client,
      () => (
        <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
      ),
      "thread-lost",
    );

    const shown = notices(container);
    expect(shown).toHaveLength(1);
    const [notice] = shown;
    expect(notice!.dataset.tone).toBe("warning");
    expect(notice!.getAttribute("role")).toBe("alert");
    expect(notice!.textContent).toContain("Connection to the agent was lost.");
    expect(notice!.querySelector(".tabler-icon-alert-triangle")).not.toBeNull();
    // It sits in the composer's notice slot, before the input frame.
    const slot = notice!.closest('[data-agent-composer-slot="notices"]');
    expect(slot).not.toBeNull();
    const input = container.querySelector('[data-agent-composer-slot="root"]');
    expect(
      slot!.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The run that lost its stream failed with the same error; no second row.
    expect(
      client.getThread("thread-lost").runs["run-thread-lost"]?.error,
    ).toMatchObject({ message: "Connection to the agent was lost." });
    expect(container.querySelector(".agentkit-run-failure")).toBeNull();
    expect(container.querySelector(".agentkit-error")).toBeNull();
    expect(container.textContent).not.toContain("Something went wrong");
  });

  it("dismisses the notice and clears it when the thread changes", async () => {
    const client = await lostConnection(["thread-lost", "thread-other"]);
    const view = await mount(
      client,
      () => (
        <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
      ),
      "thread-lost",
    );
    const dismiss = notices(view.container)[0]!.querySelector<HTMLElement>(
      'button[aria-label="Dismiss"]',
    );
    expect(dismiss).not.toBeNull();
    await act(async () => dismiss!.click());
    expect(notices(view.container)).toHaveLength(0);
    expect(client.getSnapshot().connection).toBe("error");
    // With the notice gone, the failed run keeps its own amber row.
    const dismissedRow = view.container.querySelector<HTMLElement>(
      ".agentkit-run-failure",
    );
    expect(dismissedRow?.dataset.tone).toBe("warning");
    expect(dismissedRow?.textContent).toContain(
      "Connection to the agent was lost.",
    );

    const fresh = await lostConnection(["thread-lost", "thread-other"]);
    const second = await mount(
      fresh,
      () => (
        <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
      ),
      "thread-lost",
    );
    expect(notices(second.container)).toHaveLength(1);
    await second.rerender("thread-other");
    expect(notices(second.container)).toHaveLength(0);
  });

  it("shows the failed run's row after switching away and back", async () => {
    const client = await lostConnection(["thread-lost", "thread-other"]);
    const view = await mount(
      client,
      () => (
        <AgentKitChat composerProps={{ modelStatusChecksEnabled: false }} />
      ),
      "thread-lost",
    );
    const row = () =>
      view.container.querySelector<HTMLElement>(".agentkit-run-failure");
    expect(notices(view.container)).toHaveLength(1);
    expect(row()).toBeNull();

    await view.rerender("thread-other");
    await view.rerender("thread-lost");
    expect(client.getSnapshot().connection).toBe("error");
    expect(notices(view.container)).toHaveLength(0);
    expect(row()?.dataset.tone).toBe("warning");
    expect(row()?.dataset.errorCode).toBe("network_error");
    expect(row()?.textContent).toContain("Connection to the agent was lost.");
  });

  it("keeps red for a final run failure and amber for a recoverable one", async () => {
    const failures: Record<string, AgentError> = {
      "thread-retryable": {
        code: "runtime_error",
        message: "The model provider returned an error.",
        retryable: true,
      },
      "thread-final": {
        code: "policy_denied",
        message: "This request is not allowed.",
        retryable: false,
      },
    };
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-new" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
      async getThreadSnapshot(input) {
        const threadId = threadIdOf(input);
        return snapshot(threadId, {
          status: "failed",
          error: failures[threadId],
        });
      },
    };
    const client = new AgentKitClient({ transport });
    await client.loadThread("thread-retryable");
    await client.loadThread("thread-final");
    const view = await mount(
      client,
      () => <AgentKitChat composer={false} />,
      "thread-retryable",
    );
    const row = () =>
      view.container.querySelector<HTMLElement>(".agentkit-run-failure");
    expect(row()?.dataset.tone).toBe("warning");
    expect(row()?.querySelector(".tabler-icon-alert-triangle")).not.toBeNull();

    await view.rerender("thread-final");
    expect(row()?.dataset.tone).toBe("danger");
    expect(row()?.querySelector(".tabler-icon-alert-circle")).not.toBeNull();
  });
});

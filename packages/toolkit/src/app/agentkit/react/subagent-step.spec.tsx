// @vitest-environment happy-dom

import {
  createAgentThreadState,
  reduceAgentEvent,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type { AgentEvent } from "@agent-native/agentkit/protocol";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentActivityGroup,
  AgentCollaborationFeed,
  AgentTaskGroup,
} from "./components.js";
import { AgentKitProvider } from "./context.js";

const threadId = "thread-subagent";
const runId = "run-subagent";
const app = { id: "Brain", kind: "agent", label: "Brain" };

type EventBody = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, "id" | "threadId" | "runId" | "sequence" | "occurredAt">
    : never
  : never;

function threadFrom(bodies: EventBody[]): AgentThreadState {
  let thread = createAgentThreadState(threadId);
  bodies.forEach((body, index) => {
    thread = reduceAgentEvent(thread, {
      ...body,
      id: `event-${index + 1}`,
      threadId,
      runId,
      sequence: index + 1,
      occurredAt: `2026-11-11T00:00:${String(index + 1).padStart(2, "0")}.000Z`,
    } as AgentEvent);
  });
  return thread;
}

function controllerFor(thread: AgentThreadState): AgentKitController {
  const snapshot: AgentKitSnapshot = {
    connection: "connected",
    capabilities: {},
    capabilitiesStatus: "ready",
    threads: { [threadId]: thread },
    revision: 0,
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    getThread: () => thread,
    loadThread: vi.fn(async () => thread),
  } as unknown as AgentKitController;
}

const delegation: EventBody[] = [
  { type: "run.started" },
  {
    type: "agent.registered",
    agent: {
      id: "call-1",
      name: "Brain",
      kind: "delegated-agent",
      status: "working",
      activeTaskId: "task-1",
      origin: app,
    },
  },
  {
    type: "agent.interaction",
    interaction: {
      id: "call-1:delegated:1",
      kind: "delegated",
      agentId: "call-1",
      scope: "external",
      source: app,
    },
  },
  {
    type: "task.created",
    task: {
      id: "task-1",
      title: "Summarize the release notes",
      kind: "delegated-agent",
      status: "running",
      assignedAgentId: "call-1",
      source: app,
    },
  },
  {
    type: "tool.started",
    toolCall: {
      id: "call-1-search",
      name: "search-docs",
      status: "running",
      agentId: "call-1",
    },
  },
  {
    type: "agent.interaction",
    interaction: {
      id: "call-1:message:2",
      kind: "messaged",
      agentId: "call-1",
      detail: "Found the runtime boundary.",
      scope: "external",
      source: app,
    },
  },
  {
    type: "activity.started",
    activity: {
      id: "call-1:progress",
      kind: "agent",
      label: "processing",
      detail: "Reading the contract",
      status: "running",
      agentId: "call-1",
      scope: "external",
      source: app,
    },
  },
];

describe("AgentSubagentStep", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = async (thread: AgentThreadState) => {
    await act(async () => {
      root.render(
        <AgentKitProvider
          controller={controllerFor(thread)}
          threadId={threadId}
        >
          <AgentCollaborationFeed runId={runId} />
          <AgentTaskGroup runId={runId} />
          <AgentActivityGroup runId={runId} excludeAgentActivities />
        </AgentKitProvider>,
      );
    });
  };
  const steps = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>(".agentkit-subagent-step"),
    );
  const header = (step: HTMLElement) =>
    step.querySelector<HTMLElement>(":scope > .agentkit-activity-row");
  const toggle = async (step: HTMLElement) => {
    await act(async () =>
      step
        .querySelector<HTMLElement>(
          ":scope > .agentkit-activity-row .agentkit-disclosure-summary",
        )
        ?.click(),
    );
  };

  it("folds a running delegation into one collapsed step", async () => {
    await render(threadFrom(delegation));

    expect(steps()).toHaveLength(1);
    const [step] = steps();
    if (!step) throw new Error("No subagent step");
    expect(step.dataset.status).toBe("running");
    const row = header(step);
    expect(row?.querySelector(".agentkit-agent-name")?.textContent).toBe(
      "Brain",
    );
    // The chip's shimmer is not the only sign it is working.
    expect(
      row?.querySelector(".agentkit-agent .agentkit-visually-hidden")
        ?.textContent,
    ).toBe("Running");
    expect(row?.querySelector(".agentkit-activity-label")?.textContent).toBe(
      "working",
    );
    // The task it was given is the headline, not its progress line.
    expect(row?.querySelector(".agentkit-activity-detail")?.textContent).toBe(
      "Summarize the release notes",
    );
    expect(container.querySelector(".agentkit-tasks")).toBeNull();
    expect(container.querySelector(".agentkit-agent-interaction")).toBeNull();
    expect(container.textContent?.match(/Brain/g)).toHaveLength(1);
  });

  it("holds the agent's own calls and messages without repeating its name", async () => {
    await render(threadFrom(delegation));
    const [step] = steps();
    if (!step) throw new Error("No subagent step");
    await toggle(step);

    const content = step.querySelector(".agentkit-subagent-content");
    expect(content).not.toBeNull();
    // Its call is here, not in the parent's work.
    expect(
      content?.querySelector('.agentkit-activity-item[data-status="running"]')
        ?.textContent,
    ).toContain("Search docs");
    expect(
      String(container.querySelector(".agentkit-activities")?.textContent),
    ).not.toContain("Search docs");
    // Its state is said in words, not only by the shimmer.
    expect(
      content?.querySelector(
        '.agentkit-activity-item[data-status="running"] .agentkit-visually-hidden',
      )?.textContent,
    ).toBe("Running");
    const message = content?.querySelector(
      '.agentkit-agent-interaction[data-kind="messaged"]',
    );
    expect(message?.textContent).toContain("Found the runtime boundary");
    // "delegated work" is what the row's status already says.
    expect(content?.textContent).not.toContain("delegated work");
    expect(content?.querySelector(".agentkit-agent")).toBeNull();
    expect(container.textContent?.match(/Brain/g)).toHaveLength(1);

    await toggle(step);
    expect(step.querySelector(".agentkit-subagent-content")).toBeNull();
  });

  it("shows how long a finished agent worked and its result in place", async () => {
    await render(
      threadFrom([
        ...delegation,
        {
          type: "activity.completed",
          activity: {
            id: "call-1:activity",
            kind: "agent",
            label: "finished",
            status: "completed",
            agentId: "call-1",
            scope: "external",
            source: app,
            summary: [
              {
                type: "text",
                text: "- **search-docs** `release` · done",
                format: "markdown",
              },
              {
                type: "text",
                text: "The release adds a Subagent step.",
                format: "markdown",
              },
            ],
          },
        },
        {
          type: "agent.updated",
          agent: {
            id: "call-1",
            name: "Brain",
            kind: "delegated-agent",
            status: "completed",
            origin: app,
            metadata: { durationMs: 8_000 },
          },
        },
        {
          type: "agent.interaction",
          interaction: {
            id: "call-1:completed:3",
            kind: "completed",
            agentId: "call-1",
            scope: "external",
            source: app,
          },
        },
      ]),
    );
    const [step] = steps();
    if (!step) throw new Error("No subagent step");
    expect(step.dataset.status).toBe("completed");
    expect(
      header(step)?.querySelector(".agentkit-activity-label")?.textContent,
    ).toBe("worked for 8s");

    await toggle(step);
    const content = step.querySelector(".agentkit-subagent-content");
    // The reply reads as text, not behind a second "finished" disclosure.
    expect(content?.textContent).toContain("The release adds a Subagent step.");
    expect(content?.querySelector('[data-activity-kind="agent"]')).toBeNull();
    expect(content?.textContent).not.toContain("finished");
  });

  it("marks a failed agent amber with its reason on the row", async () => {
    await render(
      threadFrom([
        ...delegation.slice(0, 3),
        {
          type: "agent.updated",
          agent: {
            id: "call-1",
            name: "Brain",
            kind: "delegated-agent",
            status: "failed",
            origin: app,
          },
        },
        {
          type: "agent.interaction",
          interaction: {
            id: "call-1:failed:2",
            kind: "failed",
            agentId: "call-1",
            detail: "Needs setup first",
            scope: "external",
            source: app,
          },
        },
      ]),
    );
    const [step] = steps();
    if (!step) throw new Error("No subagent step");
    expect(step.dataset.status).toBe("failed");
    expect(
      header(step)?.querySelector('[data-trace-status="error"]'),
    ).not.toBeNull();
    expect(
      header(step)?.querySelector(
        '.agentkit-agent[data-status="failed"] .tabler-icon-alert-triangle',
      ),
    ).not.toBeNull();
    expect(
      header(step)?.querySelector(".agentkit-activity-label")?.textContent,
    ).toBe("needs attention");
    expect(
      step.querySelector(":scope > .agentkit-activity-error")?.textContent,
    ).toBe("Needs setup first");
  });

  it("settles an agent still marked working once its run ends", async () => {
    await render(threadFrom([...delegation, { type: "run.completed" }]));
    const [step] = steps();
    if (!step) throw new Error("No subagent step");
    expect(step.dataset.status).toBe("completed");
    expect(
      header(step)
        ?.querySelector(".agentkit-agent")
        ?.getAttribute("data-status"),
    ).toBe("completed");
    expect(header(step)?.textContent).not.toContain("Running");
  });

  it("names a failed or stopped call in words", async () => {
    await render(
      threadFrom([
        ...delegation.slice(0, 3),
        {
          type: "tool.started",
          toolCall: {
            id: "call-1-read",
            name: "read-file",
            status: "running",
            agentId: "call-1",
          },
        },
        {
          type: "tool.updated",
          toolCall: {
            id: "call-1-read",
            name: "read-file",
            status: "failed",
            agentId: "call-1",
            error: { code: "denied", message: "Permission denied" },
          },
        },
        {
          type: "tool.started",
          toolCall: {
            id: "call-1-write",
            name: "write-file",
            status: "cancelled",
            agentId: "call-1",
          },
        },
      ]),
    );
    const [step] = steps();
    if (!step) throw new Error("No subagent step");
    await toggle(step);
    const words = (status: string) =>
      step.querySelector(
        `.agentkit-activity-item[data-status="${status}"] .agentkit-visually-hidden`,
      )?.textContent;
    expect(words("failed")).toBe("Failed");
    expect(words("cancelled")).toBe("Stopped");
    // A failed call keeps its row; its error is that row's error line.
    expect(
      step.querySelector('.agentkit-activity-item[data-status="failed"]')
        ?.textContent,
    ).toContain("Read file");
  });

  it("gives each delegated agent its own step", async () => {
    await render(
      threadFrom([
        ...delegation,
        {
          type: "agent.registered",
          agent: {
            id: "call-2",
            name: "Clips",
            kind: "delegated-agent",
            status: "working",
          },
        },
        {
          type: "activity.started",
          activity: {
            id: "call-2:progress",
            kind: "agent",
            label: "processing",
            detail: "Finding the recording",
            status: "running",
            agentId: "call-2",
          },
        },
      ]),
    );
    expect(steps().map((step) => step.dataset.agentId)).toEqual([
      "call-1",
      "call-2",
    ]);
    const second = steps()[1];
    if (!second) throw new Error("No second step");
    expect(
      header(second)?.querySelector(".agentkit-activity-detail")?.textContent,
    ).toBe("Finding the recording");
  });
});

describe("AgentTaskGroup progress", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("says how many tasks are done, not only how many there are", async () => {
    const statuses = [
      "completed",
      "completed",
      "running",
      "pending",
      "failed",
    ] as const;
    const thread = threadFrom([
      { type: "run.started" },
      ...statuses.map(
        (status, index): EventBody => ({
          type: "task.created",
          task: {
            id: `task-${index}`,
            title: `Task ${index + 1}`,
            status,
            ...(index === 2 ? { progress: { completed: 3, total: 4 } } : {}),
          },
        }),
      ),
    ]);
    await act(async () => {
      root.render(
        <AgentKitProvider
          controller={controllerFor(thread)}
          threadId={threadId}
        >
          <AgentTaskGroup runId={runId} />
        </AgentKitProvider>,
      );
    });
    expect(container.querySelector(".agentkit-tasks-count")?.textContent).toBe(
      "2 of 5 done",
    );
    await act(async () =>
      container.querySelector<HTMLElement>(".agentkit-tasks-summary")?.click(),
    );
    expect(
      container.querySelector(".agentkit-task-progress")?.textContent,
    ).toBe("3 of 4 done");
  });
});

// @vitest-environment happy-dom

import {
  createAgentThreadState,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type {
  AgentMessage,
  AgentApprovalRequest,
  AgentConnectionRequest,
  AgentEvent,
  AgentTask,
} from "@agent-native/agentkit/protocol";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../design-system/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../design-system/index.js")>();
  return {
    ...actual,
    Popover: ({
      trigger,
      children,
      open,
      onOpenChange,
      className,
    }: {
      trigger: ReactNode;
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      className?: string;
    }) =>
      createElement(
        "div",
        { className, onClick: () => onOpenChange?.(!open) },
        trigger,
        open
          ? createElement(
              "div",
              {
                onClick: (event: { stopPropagation: () => void }) =>
                  event.stopPropagation(),
              },
              children,
            )
          : null,
      ),
  };
});

import {
  AgentActivityGroup,
  AgentApprovalPrompt,
  AgentConnectionRequestCard,
  AgentKitChat,
  AgentMessageActions,
  AgentTaskItem,
  useAgentKitFollowTranscript,
} from "./components.js";
import { AgentKitProvider } from "./context.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function snapshotOf(
  thread: AgentThreadState,
  revision = 0,
  capabilities: AgentKitSnapshot["capabilities"] = {},
): AgentKitSnapshot {
  return {
    connection: "connected",
    capabilities,
    capabilitiesStatus: "ready",
    threads: { [thread.id]: thread },
    revision,
  };
}

function observableController(initial: AgentKitSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const cancelRun = vi.fn(async () => undefined);
  const resolveApproval = vi.fn(async () => undefined);
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getThread(threadId: string) {
      return snapshot.threads[threadId] ?? createAgentThreadState(threadId);
    },
    loadThread: vi.fn(async (threadId: string) =>
      controller.getThread(threadId),
    ),
    cancelRun,
    resolveApproval,
    uploadFiles: vi.fn(async () => []),
    invokeAction: vi.fn(async () => ({ invocationId: "invocation-1" })),
    submitFeedback: vi.fn(async () => undefined),
  } as unknown as AgentKitController;
  return {
    controller,
    cancelRun,
    resolveApproval,
    update(next: AgentKitSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
}

function runningThread(threadId: string, runId: string): AgentThreadState {
  return {
    ...createAgentThreadState(threadId),
    messages: [
      {
        id: "user-running",
        role: "user",
        status: "complete",
        parts: [{ type: "text", text: "Do the thing" }],
      },
    ],
    runs: {
      [runId]: {
        id: runId,
        status: "running",
        lastSequence: 0,
        startedAt: "2026-10-23T00:00:00.000Z",
      },
    },
    activeRunIds: [runId],
  };
}

describe("AgentKitChat papercuts", () => {
  it("offers a default Stop that cancels once however often it is clicked", async () => {
    const thread = runningThread("thread-stop", "run-stop");
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentKitChat
          composerProps={{
            autoFocus: false,
            modelStatusChecksEnabled: false,
            voiceEnabled: false,
          }}
        />
      </AgentKitProvider>,
    );

    const stop = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    expect(stop?.getAttribute("aria-label")).toBe("Stop");
    expect(stop?.hasAttribute("title")).toBe(false);
    const cancelled = Promise.withResolvers<undefined>();
    store.cancelRun.mockReturnValueOnce(cancelled.promise);
    await act(async () => {
      stop?.click();
      stop?.click();
    });
    expect(store.cancelRun).toHaveBeenCalledOnce();
    expect(store.cancelRun).toHaveBeenCalledWith("thread-stop", "run-stop");
    expect(stop?.disabled).toBe(true);
    expect(stop?.getAttribute("aria-busy")).toBe("true");
    await act(async () => cancelled.resolve(undefined));
    expect(stop?.disabled).toBe(false);
  });

  it("announces a finished response once in the shared status region", async () => {
    const thread = runningThread("thread-announce", "run-announce");
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const status = container.querySelector("[data-agentkit-live-status]");
    expect(status?.getAttribute("role")).toBe("status");

    await act(async () => {
      store.update(
        snapshotOf(
          {
            ...thread,
            activeRunIds: [],
            runs: {
              "run-announce": {
                ...thread.runs["run-announce"]!,
                status: "completed",
              },
            },
          },
          1,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector("[data-agentkit-live-status]")?.textContent,
    ).toBe("Response ready");
    expect(
      container.querySelectorAll("[data-agentkit-live-status]"),
    ).toHaveLength(1);
  });

  it("marks a stopped run under its turn", async () => {
    const thread: AgentThreadState = {
      ...createAgentThreadState("thread-cancelled"),
      messages: [
        {
          id: "user-cancelled",
          role: "user",
          status: "complete",
          parts: [{ type: "text", text: "Start" }],
        },
      ],
      runs: {
        "run-cancelled": {
          id: "run-cancelled",
          status: "cancelled",
          lastSequence: 1,
          startedAt: "2026-10-23T00:00:00.000Z",
        },
      },
    };
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    expect(container.querySelector(".agentkit-run-stopped")?.textContent).toBe(
      "Stopped",
    );
  });

  it("stops following when the reader moves up by any means, and follows again on submit", async () => {
    const thread: AgentThreadState = {
      ...createAgentThreadState("thread-follow"),
      messages: [
        {
          id: "assistant-follow",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "A long answer." }],
        },
      ],
    };
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
    const transcript = container.querySelector<HTMLElement>(
      ".agentkit-transcript",
    )!;
    expect(transcript.getAttribute("role")).toBe("region");
    expect(transcript.tabIndex).toBe(0);
    Object.defineProperty(transcript, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    transcript.scrollTop = 500;
    await act(async () => {
      transcript.dispatchEvent(new Event("scroll"));
    });
    expect(transcript.dataset.follow).toBe("true");

    // Focus moving to an earlier element scrolls without wheel or key events.
    transcript.scrollTop = 200;
    await act(async () => {
      transcript.dispatchEvent(new Event("scroll"));
    });
    expect(transcript.dataset.follow).toBe("false");
    const jump = container.querySelector<HTMLElement>(
      ".agentkit-scroll-to-bottom-control",
    );
    expect(jump?.dataset.visible).toBe("true");
  });

  it("jumps to the latest turn when a custom composer submits, not when a footer popover form does", async () => {
    const thread: AgentThreadState = {
      ...createAgentThreadState("thread-submit-follow"),
      messages: [
        {
          id: "assistant-submit-follow",
          role: "assistant",
          status: "complete",
          parts: [{ type: "text", text: "Earlier answer." }],
        },
      ],
    };
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider
        controller={store.controller}
        threadId={thread.id}
        slots={{
          composer: function CustomComposer() {
            const followTranscript = useAgentKitFollowTranscript();
            return (
              <>
                <form onSubmit={(event) => event.preventDefault()}>
                  <button type="submit">Save link</button>
                </form>
                <button type="button" onClick={followTranscript}>
                  Send
                </button>
              </>
            );
          },
        }}
      >
        <AgentKitChat />
      </AgentKitProvider>,
    );
    const transcript = container.querySelector<HTMLElement>(
      ".agentkit-transcript",
    )!;
    Object.defineProperty(transcript, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(transcript, "scrollHeight", {
      configurable: true,
      value: 600,
    });
    transcript.scrollTop = 500;
    await act(async () => transcript.dispatchEvent(new Event("scroll")));
    transcript.scrollTop = 100;
    await act(async () => transcript.dispatchEvent(new Event("scroll")));
    expect(transcript.dataset.follow).toBe("false");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(transcript.dataset.follow).toBe("false");
    expect(transcript.scrollTop).toBe(100);

    const send = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Send",
    )!;
    await act(async () => send.click());
    expect(transcript.dataset.follow).toBe("true");
    expect(transcript.scrollTop).toBe(500);
  });
});

describe("AgentMessageActions papercuts", () => {
  function threadWithAnswer(): AgentThreadState {
    return {
      ...createAgentThreadState("thread-actions"),
      messages: [
        {
          id: "user-actions",
          role: "user",
          status: "complete",
          parts: [{ type: "text", text: "Question" }],
        },
        {
          id: "assistant-actions",
          role: "assistant",
          status: "complete",
          createdAt: "2024-03-05T12:00:00.000Z",
          parts: [{ type: "text", text: "Answer" }],
        },
      ],
    };
  }

  it("marks the latest response's actions and names its branch position", async () => {
    const thread = threadWithAnswer();
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider
        controller={store.controller}
        threadId={thread.id}
        branchNavigation={{
          index: 2,
          count: 3,
          onPrevious: () => undefined,
          onNext: () => undefined,
        }}
      >
        <AgentMessageActions value={thread.messages[1]!} threadId={thread.id} />
      </AgentKitProvider>,
    );

    const actions = container.querySelector<HTMLElement>(
      ".agentkit-message-actions",
    );
    expect(actions?.dataset.latest).toBe("true");
    expect(
      container.querySelector<HTMLElement>(".agentkit-message-toolbar")?.dataset
        .latest,
    ).toBe("true");
    const branches = container.querySelector(".agentkit-branch-navigation");
    expect(branches?.getAttribute("role")).toBe("group");
    expect(branches?.getAttribute("aria-label")).toBe("Response 2 of 3");
    expect(
      branches?.querySelector('span[aria-hidden="true"]')?.textContent,
    ).toBe("2/3");
    // Branch navigation sits just before the Copy, rating and More cluster.
    expect(branches?.nextElementSibling?.className).toBe(
      "agentkit-message-actions-swap",
    );
    // Run details replace the reply timestamp.
    expect(container.querySelector("time")).toBeNull();
  });

  it("copies attached filenames and links with the user message text", async () => {
    const message: AgentMessage = {
      id: "user-files",
      role: "user",
      status: "complete",
      parts: [
        {
          type: "file",
          name: "brief.pdf",
          mediaType: "application/pdf",
          url: "https://files.example/brief.pdf",
        },
        {
          type: "file",
          name: "notes.txt",
          mediaType: "text/plain",
          url: "https://files.example/notes.txt",
        },
      ],
    };
    const thread: AgentThreadState = {
      ...createAgentThreadState("thread-copy-files"),
      messages: [message],
    };
    const store = observableController(snapshotOf(thread));
    const onCopyMessage = vi.fn(async () => false);
    const writeText = vi.fn(async () => undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      await render(
        <AgentKitProvider
          controller={store.controller}
          threadId={thread.id}
          onCopyMessage={onCopyMessage}
        >
          <AgentMessageActions value={message} threadId={thread.id} />
        </AgentKitProvider>,
      );
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Copy message"]')
          ?.click();
        await Promise.resolve();
      });

      const expectedCopyText =
        "brief.pdf\nhttps://files.example/brief.pdf\n\nnotes.txt\nhttps://files.example/notes.txt";
      expect(onCopyMessage).toHaveBeenCalledWith({
        message,
        text: expectedCopyText,
      });
      expect(writeText).toHaveBeenCalledWith(expectedCopyText);
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });
});

describe("Activity and task rows", () => {
  function failedReadThread(): AgentThreadState {
    const runId = "run-failed-read";
    const events: AgentEvent[] = [
      {
        id: "event-read",
        threadId: "thread-failed-read",
        runId,
        sequence: 1,
        occurredAt: "2026-10-23T00:00:00.000Z",
        type: "tool.updated",
        toolCall: {
          id: "tool-read",
          name: "read-file",
          status: "failed",
          error: {
            code: "tool_error",
            message: "ENOENT: no such file or directory, open 'missing.ts'",
          },
        },
      },
      {
        id: "event-done",
        threadId: "thread-failed-read",
        runId,
        sequence: 2,
        occurredAt: "2026-10-23T00:00:18.000Z",
        type: "run.completed",
      },
    ];
    return {
      ...createAgentThreadState("thread-failed-read"),
      events,
      tools: {
        "tool-read": (
          events[0] as Extract<AgentEvent, { type: "tool.updated" }>
        ).toolCall,
      },
      runs: {
        [runId]: {
          id: runId,
          status: "completed",
          lastSequence: 2,
          startedAt: "2026-10-23T00:00:00.000Z",
          completedAt: "2026-10-23T00:00:18.000Z",
        },
      },
    };
  }

  it("re-renders a run when an event in the middle is replaced", async () => {
    const runId = "run-swap";
    const toolEvent = (
      id: string,
      sequence: number,
      status: "completed" | "failed",
    ): AgentEvent => ({
      id: `event-${id}`,
      threadId: "thread-swap",
      runId,
      sequence,
      occurredAt: "2026-10-23T00:00:00.000Z",
      type: "tool.updated",
      toolCall: {
        id: `tool-${id}`,
        name: id === "a" ? "list-files" : "read-file",
        status,
        ...(status === "failed"
          ? { error: { code: "tool_error", message: "Read failed" } }
          : {}),
      },
    });
    const done: AgentEvent = {
      id: "event-done",
      threadId: "thread-swap",
      runId,
      sequence: 4,
      occurredAt: "2026-10-23T00:00:18.000Z",
      type: "run.completed",
    };
    // Only the events change between snapshots, so nothing but the event
    // index can tell the renderer that the run's work changed.
    const base: AgentThreadState = {
      ...createAgentThreadState("thread-swap"),
      runs: {
        [runId]: {
          id: runId,
          status: "completed",
          lastSequence: 4,
          startedAt: "2026-10-23T00:00:00.000Z",
          completedAt: "2026-10-23T00:00:18.000Z",
        },
      },
    };
    const threadWith = (events: AgentEvent[]): AgentThreadState => ({
      ...base,
      events,
    });
    const first = toolEvent("a", 1, "completed");
    const store = observableController(
      snapshotOf(threadWith([first, toolEvent("b", 2, "completed"), done])),
    );
    await render(
      <AgentKitProvider controller={store.controller} threadId="thread-swap">
        <AgentActivityGroup runId={runId} />
      </AgentKitProvider>,
    );
    expect(
      container.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 18s");

    await act(async () => {
      store.update(
        snapshotOf(threadWith([first, toolEvent("b", 2, "failed"), done]), 1),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 18s, 1 failed");
  });

  it("shows a failed step and counts it in the work summary", async () => {
    const thread = failedReadThread();
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentActivityGroup runId="run-failed-read" />
      </AgentKitProvider>,
    );
    const summary = container.querySelector(".agentkit-activities-summary");
    expect(summary?.textContent).toBe("Worked for 18s, 1 failed");
    // Only the failed count reads in amber.
    expect(
      summary?.querySelector(".agentkit-activities-failed")?.textContent,
    ).toBe(", 1 failed");
    // The failure reads in place, as its own line with its short reason.
    const failure = container.querySelector<HTMLElement>(
      '.agentkit-work-group[data-failed="true"]',
    );
    expect(
      failure?.querySelector(".agentkit-work-group-label")?.textContent,
    ).toBe("1 failed");
    expect(
      failure?.querySelector(".agentkit-work-failure-reason")?.textContent,
    ).toBe("ENOENT: no such file or directory, open 'missing.ts'");
    expect(
      failure?.querySelector(
        ".agentkit-disclosure-icon-slot .tabler-icon-alert-triangle",
      ),
    ).not.toBeNull();
    const row = failure?.querySelector<HTMLElement>(
      '.agentkit-activity-item[data-status="failed"]',
    );
    expect(row?.querySelector(".agentkit-activity-label")?.textContent).toBe(
      "Read file",
    );
    expect(row?.querySelector(".agentkit-activity-error")?.textContent).toBe(
      "ENOENT: no such file or directory, open 'missing.ts'",
    );
  });

  it("gives each task status an icon and a spoken label", async () => {
    const thread = createAgentThreadState("thread-tasks");
    const store = observableController(snapshotOf(thread));
    const task: AgentTask = {
      id: "task-1",
      title: "",
      status: "awaiting_input",
    };
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentTaskItem value={task} threadId={thread.id} />
      </AgentKitProvider>,
    );
    const row = container.querySelector(".agentkit-task-row");
    expect(row?.querySelector(".agentkit-task-status-icon")).not.toBeNull();
    expect(row?.querySelector(".agentkit-visually-hidden")?.textContent).toBe(
      "Needs input",
    );
    expect(row?.querySelector(".agentkit-task-title")?.textContent).toBe(
      "Untitled task",
    );
  });
});

describe("Cards", () => {
  it("names the provider in connection titles", async () => {
    const thread = createAgentThreadState("thread-connection");
    const store = observableController(snapshotOf(thread));
    const request: AgentConnectionRequest = {
      id: "connection-1",
      provider: "google-drive",
      reason: "connect",
      status: "requested",
    };
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentConnectionRequestCard request={request} runId="run-1" />
        <AgentConnectionRequestCard
          request={{ ...request, id: "connection-2", status: "declined" }}
          runId="run-1"
        />
        <AgentConnectionRequestCard
          request={{
            ...request,
            id: "connection-3",
            reason: "admin_required",
          }}
          runId="run-1"
          providerLabel="Drive"
        />
      </AgentKitProvider>,
    );
    const titles = Array.from(container.querySelectorAll("h3"), (title) =>
      title.textContent?.trim(),
    );
    expect(titles).toEqual([
      "Connect Google Drive",
      "Google Drive not connected",
      "Drive needs an admin",
    ]);
    expect(container.textContent).toContain(
      "Ask a workspace admin to connect this service.",
    );
  });

  it("keeps replacement patterns in provider labels literal", async () => {
    const thread = createAgentThreadState("thread-connection-literal");
    const store = observableController(snapshotOf(thread));
    const request: AgentConnectionRequest = {
      id: "connection-1",
      provider: "acme",
      reason: "connect",
      status: "requested",
    };
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentConnectionRequestCard
          request={request}
          runId="run-1"
          providerLabel="Acme $& $1"
        />
        <AgentConnectionRequestCard
          request={{ ...request, id: "connection-2", status: "declined" }}
          runId="run-1"
          providerLabel="Acme $& $1"
        />
        <AgentConnectionRequestCard
          request={{
            ...request,
            id: "connection-3",
            reason: "admin_required",
          }}
          runId="run-1"
          providerLabel="Acme $& $1"
        />
      </AgentKitProvider>,
    );
    const titles = Array.from(container.querySelectorAll("h3"), (title) =>
      title.textContent?.trim(),
    );
    expect(titles).toEqual([
      "Connect Acme $& $1",
      "Acme $& $1 not connected",
      "Acme $& $1 needs an admin",
    ]);
  });

  it("keeps the server detail on an admin-required connection", async () => {
    const thread = createAgentThreadState("thread-connection-detail");
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentConnectionRequestCard
          request={{
            id: "connection-detail",
            provider: "google-drive",
            reason: "admin_required",
            status: "requested",
            detail: "Ask Dana in IT to approve the Drive app.",
          }}
          runId="run-1"
        />
      </AgentKitProvider>,
    );
    expect(container.querySelector("p")?.textContent).toBe(
      "Ask Dana in IT to approve the Drive app.",
    );
  });

  it("exposes exclusive approval choices as a labelled radio group", async () => {
    const thread = createAgentThreadState("thread-approval");
    const store = observableController(snapshotOf(thread));
    const request: AgentApprovalRequest = {
      id: "approval-1",
      kind: "choice",
      title: "Pick a plan",
      options: [
        { id: "small", label: "Small" },
        { id: "large", label: "Large" },
      ],
      allowOther: false,
    };
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentApprovalPrompt request={request} runId="run-1" />
      </AgentKitProvider>,
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Pick a plan");
    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
    ]);
    radios[0]!.focus();
    await act(async () => {
      radios[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(radios[1]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
    ]);
    await act(async () => radios[1]!.click());
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
    ]);
    const submit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Submit",
    );
    await act(async () => {
      submit!.click();
      await Promise.resolve();
    });
    expect(store.resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: "approval-1",
        response: expect.objectContaining({
          decision: "approve",
          optionIds: ["large"],
        }),
      }),
    );
  });

  it("keeps focus in the group when arrowing onto Other", async () => {
    const thread = createAgentThreadState("thread-approval-other-arrow");
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentApprovalPrompt
          request={{
            id: "approval-other-arrow",
            kind: "choice",
            title: "Pick a plan",
            options: [{ id: "small", label: "Small" }],
          }}
          runId="run-1"
        />
      </AgentKitProvider>,
    );
    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    );
    radios[0]!.focus();
    await act(async () => {
      radios[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(radios[1]);
    expect(container.querySelector("input")).toBeNull();
  });

  it("lets an exclusive Other choice be deselected", async () => {
    const thread = createAgentThreadState("thread-approval-other-toggle");
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentApprovalPrompt
          request={{
            id: "approval-other-toggle",
            kind: "choice",
            title: "Pick a plan",
            options: [{ id: "small", label: "Small" }],
          }}
          runId="run-1"
        />
      </AgentKitProvider>,
    );
    const other = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ).find((button) => button.textContent === "Other")!;
    await act(async () => other.click());
    expect(other.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("input")).not.toBeNull();
    await act(async () => other.click());
    expect(other.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector("input")).toBeNull();
  });

  it("does not resolve the approval when Enter is pressed in the Other field", async () => {
    const thread = createAgentThreadState("thread-approval-other-enter");
    const store = observableController(snapshotOf(thread));
    await render(
      <AgentKitProvider controller={store.controller} threadId={thread.id}>
        <AgentApprovalPrompt
          request={{
            id: "approval-other-enter",
            kind: "choice",
            title: "Pick a plan",
            options: [{ id: "small", label: "Small" }],
          }}
          runId="run-1"
        />
      </AgentKitProvider>,
    );
    const other = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ).find((button) => button.textContent === "Other")!;
    await act(async () => other.click());
    const input = container.querySelector<HTMLInputElement>("input")!;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(input, "Medium");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(container.querySelector("form")).toBeNull();
    expect(store.resolveApproval).not.toHaveBeenCalled();
  });
});

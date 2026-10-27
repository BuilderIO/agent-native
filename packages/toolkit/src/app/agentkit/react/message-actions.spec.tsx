// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit/client";
import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "./components.js";
import { AgentKitProvider, type AgentKitRunUsageLoader } from "./context.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const THREAD = "thread-actions";

const userMessage: AgentMessage = {
  id: "user-1",
  role: "user",
  status: "complete",
  createdAt: "2026-10-23T00:00:00.000Z",
  parts: [{ type: "text", text: "Question" }],
};
const olderAnswer: AgentMessage = {
  id: "assistant-older",
  role: "assistant",
  status: "complete",
  createdAt: "2026-10-23T00:00:01.000Z",
  parts: [{ type: "text", text: "First answer" }],
};
const followUp: AgentMessage = {
  id: "user-2",
  role: "user",
  status: "complete",
  createdAt: "2026-10-23T00:00:02.000Z",
  parts: [
    { type: "text", text: "And then?" },
    {
      type: "file",
      name: "notes.txt",
      mediaType: "text/plain",
      url: "https://files.example.test/notes.txt",
    },
  ],
  metadata: { model: "model-large", requestMode: "act", effort: "high" },
};
const latestAnswer: AgentMessage = {
  id: "assistant-latest",
  role: "assistant",
  status: "complete",
  createdAt: "2026-10-23T00:00:03.000Z",
  parts: [{ type: "text", text: "Second answer" }],
};

function runEvents(
  runId: string,
  work: Array<Omit<AgentEvent, "id" | "threadId" | "runId" | "sequence">>,
  message: AgentMessage,
  firstSequence = 1,
): AgentEvent[] {
  return [
    { type: "run.started", occurredAt: "2026-10-23T00:00:02.000Z" },
    ...work,
    {
      type: "message.completed",
      occurredAt: "2026-10-23T00:00:03.000Z",
      message,
    },
    { type: "run.completed", occurredAt: "2026-10-23T00:00:03.500Z" },
  ].map(
    (event, index) =>
      ({
        ...event,
        id: `${runId}-event-${index}`,
        threadId: THREAD,
        runId,
        sequence: firstSequence + index,
      }) as AgentEvent,
  );
}

const toolWork = [
  {
    type: "tool.started",
    occurredAt: "2026-10-23T00:00:02.100Z",
    toolCall: { id: "tool-search", name: "search", status: "running" },
  },
  {
    type: "tool.updated",
    occurredAt: "2026-10-23T00:00:02.900Z",
    toolCall: { id: "tool-search", name: "search", status: "completed" },
  },
] as const;

async function renderChat(
  options: {
    submitFeedback?: AgentTransport["submitFeedback"];
    loadRunUsage?: AgentKitRunUsageLoader;
    events?: AgentEvent[];
    toolCalls?: AgentToolCall[];
    transport?: Partial<AgentTransport>;
    onThreadForked?: () => void;
    followUpModel?: string;
    formatModelName?: (model: string) => string;
  } = {},
) {
  const submitFeedback = options.submitFeedback ?? vi.fn(async () => undefined);
  const transport: AgentTransport = {
    capabilities: { feedback: true, threadForking: true },
    submitFeedback,
    async startRun() {
      return { runId: "run-new" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async forkThread(input) {
      return {
        id: `${input.threadId}-fork`,
        createdAt: "2026-10-23T00:00:00.000Z",
        updatedAt: "2026-10-23T00:00:00.000Z",
      };
    },
    async getThreadSnapshot({ threadId }) {
      return {
        id: threadId,
        createdAt: "2026-10-23T00:00:00.000Z",
        updatedAt: "2026-10-23T00:00:03.000Z",
        messages: [
          userMessage,
          olderAnswer,
          options.followUpModel
            ? {
                ...followUp,
                metadata: {
                  ...followUp.metadata,
                  model: options.followUpModel,
                },
              }
            : followUp,
          latestAnswer,
        ],
        ...(options.toolCalls ? { toolCalls: options.toolCalls } : {}),
        events: options.events ?? [
          {
            id: "event-latest",
            threadId,
            runId: "run-latest",
            sequence: 1,
            occurredAt: "2026-10-23T00:00:03.000Z",
            type: "message.completed",
            message: latestAnswer,
          },
        ],
      };
    },
    ...options.transport,
  };
  const client = new AgentKitClient({ transport });
  await client.loadThread(THREAD);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const render = async (node: ReactNode) =>
    act(async () => {
      root.render(node);
      await Promise.resolve();
    });
  await render(
    <AgentKitProvider
      controller={client}
      threadId={THREAD}
      onThreadForked={options.onThreadForked ?? (() => undefined)}
      loadRunUsage={options.loadRunUsage}
      formatModelName={options.formatModelName}
    >
      <AgentKitChat composer={false} />
    </AgentKitProvider>,
  );
  cleanups.push(async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    await client.shutdown();
    container.remove();
    if (previousActEnvironment === undefined) {
      delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    } else {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
  const footer = (messageId: string) =>
    container.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"] .agentkit-message-actions`,
    )!;
  const toolbar = (messageId: string) => {
    return container.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"] .agentkit-message-toolbar`,
    )!;
  };
  return { container, client, submitFeedback, footer, toolbar };
}

async function press(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function labelsOf(set: Element | null | undefined) {
  return Array.from(set?.querySelectorAll("button") ?? []).map((button) =>
    button.getAttribute("aria-label"),
  );
}

function set(toolbar: HTMLElement, name: "primary" | "secondary") {
  return toolbar.querySelector<HTMLElement>(
    `.agentkit-message-actions-set[data-set="${name}"]`,
  );
}

function toggle(toolbar: HTMLElement) {
  return toolbar.querySelector<HTMLButtonElement>(
    "button[data-message-actions-toggle]",
  )!;
}

function thumb(toolbar: HTMLElement, value: "positive" | "negative") {
  return toolbar.querySelector<HTMLButtonElement>(
    `button[data-message-action="feedback-${value}"]`,
  )!;
}

describe("assistant reply toolbar", () => {
  it("shows Copy, both thumbs and More at rest, with no rating menu or timestamp", async () => {
    const { footer, toolbar } = await renderChat();
    const latest = toolbar("assistant-latest");
    const older = toolbar("assistant-older");

    expect(latest.dataset.latest).toBe("true");
    expect(older.dataset.latest).toBeUndefined();
    expect(footer("assistant-latest").dataset.placement).toBe("inline");
    expect(latest.getAttribute("role")).toBe("group");
    expect(labelsOf(set(latest, "primary"))).toEqual([
      "Copy message",
      "Good response",
      "Bad response",
    ]);
    expect(set(latest, "primary")?.dataset.active).toBe("true");
    expect(set(latest, "secondary")?.dataset.active).toBe("false");
    expect(set(latest, "secondary")?.hasAttribute("inert")).toBe(true);
    // The toggle sits after the swap, so the incoming set never moves it.
    expect(latest.lastElementChild?.previousElementSibling).toBe(
      toggle(latest),
    );
    expect(toggle(latest).getAttribute("aria-label")).toBe("More actions");
    expect(toggle(latest).getAttribute("aria-expanded")).toBe("false");
    expect(
      toggle(latest).querySelector("svg")?.getAttribute("class"),
    ).toContain("tabler-icon-dots");
    expect(latest.querySelector("[aria-haspopup]")).toBeNull();
    expect(footer("assistant-latest").querySelector("time")).toBeNull();
    // Only the latest reply can be retried, and only a run has a request ID.
    expect(labelsOf(set(latest, "secondary"))).toEqual([
      "Retry",
      "Fork from here",
      "Copy request ID",
    ]);
    expect(labelsOf(set(older, "secondary"))).toEqual(["Fork from here"]);
  });

  it("names each icon-only action in a tooltip on hover", async () => {
    const { container, toolbar } = await renderChat();
    const latest = toolbar("assistant-latest");
    const user = container.querySelector<HTMLElement>(
      '[data-message-id="user-2"] .agentkit-message-actions',
    )!;
    const hoverName = async (button: HTMLButtonElement) => {
      vi.useFakeTimers();
      try {
        await act(async () => {
          button.dispatchEvent(
            new PointerEvent("pointermove", {
              bubbles: true,
              pointerType: "mouse",
            }),
          );
          vi.advanceTimersByTime(1000);
        });
        const name = document.querySelector('[role="tooltip"]')?.textContent;
        await act(async () => {
          button.dispatchEvent(
            new PointerEvent("pointerleave", {
              bubbles: true,
              pointerType: "mouse",
            }),
          );
          vi.advanceTimersByTime(1000);
        });
        return name;
      } finally {
        vi.useRealTimers();
      }
    };

    const names: Array<string | null | undefined> = [];
    const hoverAll = async (scope: HTMLElement) => {
      for (const button of Array.from(scope.querySelectorAll("button"))) {
        // The idle set is inert, so only the open set's actions can be hovered.
        if (!button.closest("[inert]")) names.push(await hoverName(button));
      }
    };
    await hoverAll(latest);
    await press(toggle(latest));
    await hoverAll(set(latest, "secondary")!);
    await hoverAll(user);
    expect(names).toEqual([
      "Copy message",
      "Good response",
      "Bad response",
      "More actions",
      "Retry",
      "Fork from here",
      "Copy request ID",
      "Copy message",
    ]);
  });

  it("shows More as pressed while its actions are open, past its hover fill", async () => {
    const { toolbar } = await renderChat();
    const more = toggle(toolbar("assistant-latest"));
    const classes = () => more.className.split(/\s+/);

    // The open fill is the toolkit's full accent, the hover fill a lighter one.
    expect(classes()).toEqual(
      expect.arrayContaining(["aria-expanded:bg-accent", "hover:bg-accent/60"]),
    );
    expect(classes()).not.toContain("hover:bg-accent");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await press(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
  });

  it("swaps the primary set for the secondary set in place and reverts on toggle, Esc, outside press and blur", async () => {
    const { toolbar } = await renderChat();
    const latest = toolbar("assistant-latest");
    const more = toggle(latest);

    await press(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(latest.dataset.expanded).toBe("true");
    expect(set(latest, "primary")?.dataset.active).toBe("false");
    expect(set(latest, "primary")?.hasAttribute("inert")).toBe(true);
    expect(set(latest, "secondary")?.dataset.active).toBe("true");
    expect(set(latest, "secondary")?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Retry");
    expect(toggle(latest)).toBe(more);

    await press(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);

    await press(more);
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(set(latest, "primary")?.dataset.active).toBe("true");
    expect(document.activeElement).toBe(more);

    await press(more);
    await act(async () => {
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    await press(more);
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => {
      outside.focus();
      await Promise.resolve();
    });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    outside.remove();
  });

  it("submits a thumb immediately with the message trace, ignores the same choice and switches to the other", async () => {
    const { toolbar, submitFeedback } = await renderChat();
    const latest = toolbar("assistant-latest");

    await press(thumb(latest, "positive"));
    expect(submitFeedback).toHaveBeenCalledOnce();
    expect(submitFeedback).toHaveBeenCalledWith(
      {
        threadId: THREAD,
        messageId: "assistant-latest",
        value: "positive",
        runId: "run-latest",
        messageSeq: 3,
      },
      expect.anything(),
    );
    expect(thumb(latest, "positive").getAttribute("aria-pressed")).toBe("true");
    expect(
      thumb(latest, "positive").querySelector("svg")?.getAttribute("class"),
    ).toContain("tabler-icon-thumb-up-filled");
    expect(thumb(latest, "negative").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(latest.textContent).toContain("Feedback submitted");

    await press(thumb(latest, "positive"));
    expect(submitFeedback).toHaveBeenCalledOnce();

    await press(thumb(latest, "negative"));
    expect(submitFeedback).toHaveBeenCalledTimes(2);
    expect(submitFeedback).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: "negative" }),
      expect.anything(),
    );
    expect(thumb(latest, "negative").getAttribute("aria-pressed")).toBe("true");
    expect(thumb(latest, "positive").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("shows the error and leaves the rating unchanged when feedback fails to save", async () => {
    const submitFeedback = vi.fn(async () => {
      throw new Error("Feedback could not be saved.");
    });
    const { footer, toolbar } = await renderChat({ submitFeedback });
    const latest = toolbar("assistant-latest");

    await press(thumb(latest, "negative"));

    expect(submitFeedback).toHaveBeenCalledOnce();
    expect(
      footer("assistant-latest").querySelector("[role=alert]")?.textContent,
    ).toContain("Feedback could not be saved.");
    expect(footer("assistant-latest").dataset.hasError).toBe("true");
    expect(thumb(latest, "negative").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("retries the latest reply by forking before the previous request and resending it", async () => {
    const forkThread = vi.fn(async (input: { threadId: string }) => ({
      id: `${input.threadId}-fork`,
      createdAt: "2026-10-23T00:00:00.000Z",
      updatedAt: "2026-10-23T00:00:00.000Z",
    }));
    const startRun = vi.fn(async () => ({ runId: "run-retry" }));
    const onThreadForked = vi.fn();
    const assertAiSetupReady = vi.fn(async () => undefined);
    const { toolbar } = await renderChat({
      transport: { forkThread, startRun, assertAiSetupReady },
      onThreadForked,
    });
    const latest = toolbar("assistant-latest");

    await press(toggle(latest));
    await press(latest.querySelector('button[aria-label="Retry"]'));

    // Readiness is checked before the fork exists.
    expect(assertAiSetupReady.mock.invocationCallOrder[0]).toBeLessThan(
      forkThread.mock.invocationCallOrder[0]!,
    );
    expect(forkThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: THREAD,
        fromMessageId: "assistant-older",
      }),
      expect.anything(),
    );
    expect(onThreadForked).toHaveBeenCalledWith(
      expect.objectContaining({ id: `${THREAD}-fork` }),
    );
    expect(startRun).toHaveBeenCalledOnce();
    const [request] = startRun.mock.calls[0] as unknown as [
      {
        threadId: string;
        input: { message?: { parts?: AgentMessage["parts"] } };
        options?: { model?: string; mode?: string; reasoningEffort?: string };
      },
    ];
    expect(request.threadId).toBe(`${THREAD}-fork`);
    expect(JSON.stringify(request)).toContain("And then?");
    expect(JSON.stringify(request)).toContain("notes.txt");
    expect(request.options).toEqual(
      expect.objectContaining({
        model: "model-large",
        mode: "act",
        reasoningEffort: "high",
      }),
    );
  });
});

describe("assistant reply toolbar placement", () => {
  it("sits under the reply, not on the Worked for row above it", async () => {
    const { container, footer, toolbar } = await renderChat({
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    const row = container.querySelector<HTMLElement>(
      ".agentkit-activities-row",
    )!;
    const latest = toolbar("assistant-latest");

    expect(row.contains(latest)).toBe(false);
    expect(row.querySelector(".agentkit-message-toolbar")).toBeNull();
    expect(footer("assistant-latest").contains(latest)).toBe(true);
    expect(footer("assistant-latest").dataset.placement).toBe("inline");
    expect(footer("assistant-older").dataset.placement).toBe("inline");
  });
});

describe("Worked for run details", () => {
  it("loads usage when opened and lists credits, tool calls and model before the work rows", async () => {
    let resolveUsage: (
      value: Awaited<ReturnType<AgentKitRunUsageLoader>>,
    ) => void = () => undefined;
    const loadRunUsage = vi.fn<AgentKitRunUsageLoader>(
      () =>
        new Promise((resolve) => {
          resolveUsage = resolve;
        }),
    );
    const { container } = await renderChat({
      loadRunUsage,
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    const work = container.querySelector<HTMLElement>(".agentkit-activities")!;
    const summary = work.querySelector<HTMLButtonElement>(
      ".agentkit-activities-summary",
    )!;

    expect(loadRunUsage).not.toHaveBeenCalled();
    await press(summary);
    expect(loadRunUsage).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-latest" }),
    );
    const details = work.querySelector<HTMLElement>(".agentkit-run-details")!;
    expect(details.tagName).toBe("DL");
    expect(details.getAttribute("aria-label")).toBe("Run details");
    expect(
      work.querySelector(".agentkit-disclosure-content")?.firstElementChild,
    ).toBe(details);
    expect(
      details.querySelector('[data-detail="credits"] [role="status"]'),
    ).toBeTruthy();

    await act(async () => {
      resolveUsage({
        durationMs: 1_000,
        billing: {
          providerCostUsd: 0.02,
          providerCostSource: "reported",
          builderCredits: 2.5,
          builderCreditsSource: "estimated",
          incomplete: false,
        },
      });
      await Promise.resolve();
    });
    const rows = Array.from(
      details.querySelectorAll(".agentkit-run-details-row"),
      (row) => [
        row.querySelector("dt")?.textContent,
        row.querySelector("dd")?.textContent,
      ],
    );
    expect(rows).toEqual([
      ["Credits used", "2.5 estimated"],
      ["Tool calls", "1"],
      ["Model used", "model-large"],
    ]);
    expect(details.textContent).not.toContain("Request ID");
    // The summary line keeps only its duration.
    expect(summary.textContent).toBe(
      summary.querySelector(".agentkit-activities-label")?.textContent,
    );
    expect(summary.textContent).not.toContain("credits");
  });

  it("shows Unavailable when usage fails to load and the cost when only cost is known", async () => {
    const failing = vi.fn<AgentKitRunUsageLoader>(async () => {
      throw new Error("usage down");
    });
    const failed = await renderChat({
      loadRunUsage: failing,
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    await press(failed.container.querySelector(".agentkit-activities-summary"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      failed.container.querySelector('[data-detail="credits"] dd')?.textContent,
    ).toBe("Unavailable");

    const costOnly = await renderChat({
      loadRunUsage: async () => ({
        durationMs: null,
        billing: {
          providerCostUsd: 0.02,
          providerCostSource: "reported",
          builderCredits: null,
          builderCreditsSource: null,
          incomplete: false,
        },
      }),
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    await press(
      costOnly.container.querySelector(".agentkit-activities-summary"),
    );
    const credits = costOnly.container.querySelector('[data-detail="credits"]');
    expect(credits?.querySelector("dt")?.textContent).toBe("Cost");
    expect(credits?.querySelector("dd")?.textContent).toBe("$0.02");
  });

  it("hides a measured zero but still shows a missing reading", async () => {
    for (const billing of [
      {
        providerCostUsd: 0,
        providerCostSource: "reported" as const,
        builderCredits: 0,
        builderCreditsSource: "estimated" as const,
        incomplete: false,
      },
      {
        providerCostUsd: 0,
        providerCostSource: "reported" as const,
        builderCredits: null,
        builderCreditsSource: null,
        incomplete: false,
      },
    ]) {
      const zero = await renderChat({
        loadRunUsage: async () => ({ durationMs: null, billing }),
        events: runEvents("run-latest", [...toolWork], latestAnswer),
      });
      await press(zero.container.querySelector(".agentkit-activities-summary"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        zero.container.querySelector('[data-detail="credits"]'),
      ).toBeNull();
      expect(
        zero.container.querySelector('[data-detail="tool-calls"] dd')
          ?.textContent,
      ).toBe("1");
    }

    const unrecorded = await renderChat({
      loadRunUsage: async () => ({ durationMs: null, billing: null }),
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    await press(
      unrecorded.container.querySelector(".agentkit-activities-summary"),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      unrecorded.container.querySelector('[data-detail="credits"] dd')
        ?.textContent,
    ).toBeTruthy();
  });

  it("counts a saved run's tool calls when only their activity events were kept", async () => {
    const { container } = await renderChat({
      toolCalls: [
        {
          id: "call-1",
          name: "search",
          status: "completed",
          runId: "run-latest",
        },
        {
          id: "call-2",
          name: "read",
          status: "completed",
          runId: "run-latest",
        },
      ],
      events: runEvents(
        "run-latest",
        [
          {
            type: "activity.completed",
            occurredAt: "2026-10-23T00:00:02.200Z",
            activity: {
              id: "call-1",
              kind: "search",
              label: "Search",
              status: "completed",
            },
          },
          {
            type: "activity.completed",
            occurredAt: "2026-10-23T00:00:02.400Z",
            activity: {
              id: "call-2",
              kind: "read",
              label: "Read",
              status: "completed",
            },
          },
        ],
        latestAnswer,
      ),
    });
    await press(container.querySelector(".agentkit-activities-summary"));
    expect(
      container.querySelector('[data-detail="tool-calls"] dd')?.textContent,
    ).toBe("2");
  });

  it("names the model an Auto request ran from the run's usage", async () => {
    let resolveUsage: (
      value: Awaited<ReturnType<AgentKitRunUsageLoader>>,
    ) => void = () => undefined;
    const { container } = await renderChat({
      followUpModel: "auto",
      formatModelName: (model) =>
        model === "gpt-6-luna" ? "GPT-6 Luna" : model,
      loadRunUsage: () =>
        new Promise((resolve) => {
          resolveUsage = resolve;
        }),
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    await press(container.querySelector(".agentkit-activities-summary"));
    const details = container.querySelector(".agentkit-run-details")!;
    // Auto is the selection, not a model, so nothing shows until the usage
    // names what ran.
    expect(details.querySelector('[data-detail="model"]')).toBeNull();
    await act(async () => {
      resolveUsage({
        durationMs: null,
        model: "gpt-6-luna",
        billing: {
          providerCostUsd: null,
          providerCostSource: null,
          builderCredits: 1.5,
          builderCreditsSource: "reported",
          incomplete: false,
        },
      });
      await Promise.resolve();
    });
    expect(details.querySelector('[data-detail="model"] dd')?.textContent).toBe(
      "GPT-6 Luna",
    );
  });

  it("prefers the model the run reported over a pinned selection", async () => {
    const { container } = await renderChat({
      loadRunUsage: async () => ({
        durationMs: null,
        model: "model-fallback",
        billing: null,
      }),
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    await press(container.querySelector(".agentkit-activities-summary"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container.querySelector('[data-detail="model"] dd')?.textContent,
    ).toBe("model-fallback");
  });

  it("omits the model row when Auto ran and no call recorded a model", async () => {
    const { container } = await renderChat({
      followUpModel: "auto",
      loadRunUsage: async () => ({
        durationMs: null,
        model: null,
        billing: null,
      }),
      events: runEvents("run-latest", [...toolWork], latestAnswer),
    });
    await press(container.querySelector(".agentkit-activities-summary"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const details = container.querySelector(".agentkit-run-details");
    expect(
      details?.querySelector('[data-detail="tool-calls"] dd')?.textContent,
    ).toBe("1");
    expect(details?.querySelector('[data-detail="model"]')).toBeNull();
  });

  it("omits the model row when no model was recorded", async () => {
    const { container, client } = await renderChat({
      events: runEvents("run-older", [...toolWork], olderAnswer),
    });
    expect(
      client.getThread(THREAD).messages[0]?.metadata?.model,
    ).toBeUndefined();
    await press(container.querySelector(".agentkit-activities-summary"));
    const details = container.querySelector(".agentkit-run-details");
    expect(
      details?.querySelector('[data-detail="tool-calls"] dd')?.textContent,
    ).toBe("1");
    expect(details?.querySelector('[data-detail="model"]')).toBeNull();
    // No usage loader: no credits row rather than a made-up value.
    expect(details?.querySelector('[data-detail="credits"]')).toBeNull();
  });
});

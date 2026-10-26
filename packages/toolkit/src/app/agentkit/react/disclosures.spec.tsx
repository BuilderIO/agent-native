// @vitest-environment happy-dom

import {
  AgentKitClient,
  createAgentThreadState,
  reduceAgentEvent,
  type AgentKitController,
  type AgentKitSnapshot,
  type AgentThreadState,
} from "@agent-native/agentkit/client";
import type {
  AgentEvent,
  AgentMessage,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentKitChat,
  AgentMessagePartView,
  AgentMessageView,
} from "./components.js";
import { AgentKitProvider, type AgentKitLabels } from "./context.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const THREAD = "thread-disclosures";
const RUN = "run-disclosures";
const T0 = Date.parse("2026-10-23T00:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

const user: AgentMessage = {
  id: "user-1",
  role: "user",
  status: "complete",
  createdAt: at(0),
  parts: [{ type: "text", text: "Question" }],
};

function answer(parts: AgentMessage["parts"]): AgentMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    status: "complete",
    createdAt: at(9_000),
    parts,
  };
}

function eventsOf(
  work: Array<Omit<AgentEvent, "id" | "threadId" | "runId" | "sequence">>,
  message: AgentMessage,
): AgentEvent[] {
  const all = [
    { type: "run.started", occurredAt: at(0) },
    ...work,
    { type: "message.completed", occurredAt: at(9_000), message },
    { type: "run.completed", occurredAt: at(9_500) },
  ];
  return all.map(
    (event, index) =>
      ({
        ...event,
        id: `event-${index}`,
        threadId: THREAD,
        runId: RUN,
        sequence: index + 1,
      }) as AgentEvent,
  );
}

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previous = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => {
    root.render(node);
    await Promise.resolve();
  });
  cleanups.push(async () => {
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    container.remove();
    if (previous === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    else actEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  return container;
}

function staticController(threadState: AgentThreadState) {
  const snapshot: AgentKitSnapshot = {
    connection: "connected",
    capabilities: {},
    capabilitiesStatus: "ready",
    threads: { [threadState.id]: threadState },
    revision: 0,
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    getThread: (threadId: string) =>
      snapshot.threads[threadId] ?? createAgentThreadState(threadId),
    loadThread: async (threadId: string) =>
      snapshot.threads[threadId] ?? createAgentThreadState(threadId),
    uploadFiles: async () => [],
    invokeAction: async () => ({ invocationId: "invocation-1" }),
    resolveApproval: async () => undefined,
    resolveConnectionRequest: async () => undefined,
  } as unknown as AgentKitController;
}

async function renderThread(
  messages: AgentMessage[],
  events: AgentEvent[],
  labels?: Partial<AgentKitLabels>,
) {
  const reduced = events.reduce(
    reduceAgentEvent,
    createAgentThreadState(THREAD),
  );
  const threadState = { ...reduced, messages };
  return mount(
    <AgentKitProvider
      controller={staticController(threadState)}
      threadId={THREAD}
      labels={labels}
    >
      <AgentKitChat composer={false} />
    </AgentKitProvider>,
  );
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

function expectSharedSummary(trigger: HTMLElement | null) {
  expect(trigger?.tagName).toBe("BUTTON");
  const children = Array.from(trigger?.children ?? []).map(
    (child) => child.classList[child.classList.length - 1],
  );
  // Icon column first, then the label, then the chevron right after it.
  expect(children).toEqual([
    "agentkit-disclosure-icon-slot",
    "agentkit-disclosure-label",
    "agentkit-disclosure-chevron",
  ]);
}

function activityEvents(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    type: "activity.completed" as const,
    occurredAt: at(1_000 + index * 100),
    activity: {
      id: `activity-${index}`,
      kind: "read",
      label: `Read file ${index}`,
      status: "completed" as const,
      detail: index === 0 ? "12 lines" : undefined,
      summary:
        index === 0
          ? [{ type: "text" as const, text: "First file contents" }]
          : undefined,
    },
  }));
}

describe("AgentKit disclosures", () => {
  it("uses one full-row button summary for work and activity rows", async () => {
    const message = answer([{ type: "text", text: "Done." }]);
    const container = await renderThread(
      [user, message],
      eventsOf(activityEvents(2), message),
    );
    const work = container.querySelector<HTMLElement>(".agentkit-activities")!;
    const trigger = work.querySelector<HTMLElement>(
      ":scope > .agentkit-activities-row > .agentkit-disclosure-summary",
    );
    expectSharedSummary(trigger);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    const contentId = trigger?.getAttribute("aria-controls");
    const content = contentId ? document.getElementById(contentId) : null;
    expect(content?.hidden).toBe(true);
    // Content stays mounted while closed.
    expect(content?.querySelectorAll(".agentkit-activity-item")).toHaveLength(
      2,
    );

    await click(trigger);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(work.dataset.open).toBe("true");
    expect(content?.hidden).toBe(false);

    const item = work.querySelector<HTMLElement>(
      '.agentkit-activity-item[data-activity-kind="read"]',
    )!;
    const itemTrigger = item.querySelector<HTMLElement>(
      ".agentkit-activity-row > .agentkit-disclosure-summary",
    );
    expectSharedSummary(itemTrigger);
    expect(item.querySelector(".agentkit-activity-disclosure")).toBeNull();
    // A click on the trailing detail still toggles the row.
    await click(item.querySelector(".agentkit-activity-detail"));
    expect(itemTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(item.querySelector(".agentkit-activity-summary")?.id).toBe(
      itemTrigger?.getAttribute("aria-controls"),
    );
    expect(item.textContent).toContain("First file contents");
    await click(itemTrigger);
    expect(item.querySelector(".agentkit-activity-summary")).toBeNull();

    // A row with nothing to expand is text, not a disabled button.
    const plain = work.querySelectorAll<HTMLElement>(
      ".agentkit-activity-item",
    )[1]!;
    expect(plain.querySelector("button")).toBeNull();
    expect(plain.querySelector(".agentkit-disclosure-chevron")).toBeNull();
  });

  it("shows six steps, then a localized Show more steps row", async () => {
    const sections = Array.from(
      { length: 9 },
      (_, index) => `**Step ${index}** Looking at file ${index}. `,
    );
    const message = answer([
      { type: "reasoning", text: sections.join(""), visibility: "visible" },
      { type: "text", text: "Done." },
    ]);
    const work = sections.flatMap((text, index) => [
      {
        type: "reasoning.delta" as const,
        occurredAt: at(1_000 + index * 100),
        messageId: message.id,
        text,
      },
      ...activityEvents(9)
        .slice(index, index + 1)
        .map((event) =>
          index === 8
            ? {
                ...event,
                activity: { ...event.activity, status: "failed" as const },
              }
            : event,
        ),
    ]);
    const container = await renderThread(
      [user, message],
      eventsOf(work, message),
      { showMoreWorkStepsOther: "Mostrar {{count}} pasos más" },
    );
    await click(
      container.querySelector(
        ".agentkit-activities-row > .agentkit-disclosure-summary",
      ),
    );
    const list = container.querySelector<HTMLElement>(".agentkit-work-steps")!;
    expect(list.getAttribute("role")).toBe("list");
    // A step with a failure stays in view after the Show more row.
    expect(list.children).toHaveLength(8);
    const more = list.querySelector<HTMLButtonElement>(
      ".agentkit-work-steps-more button",
    );
    expect(more?.textContent).toBe("Mostrar 2 pasos más");
    expect(more?.hasAttribute("aria-expanded")).toBe(false);
    expect(list.textContent).not.toContain("Step 6");
    expect(list.lastElementChild?.textContent).toContain("Step 8");
    // Each step lists the call that followed its heading.
    expect(list.children[0]?.textContent).toContain("Step 0");
    expect(list.children[0]?.textContent).toContain("Read file 0");

    more?.focus();
    await click(more);
    expect(list.children).toHaveLength(9);
    expect(list.querySelector(".agentkit-work-steps-more")).toBeNull();
    expect(list.textContent).toContain("Read file 8");
    // Focus lands on the first revealed step instead of the document.
    expect(document.activeElement).toBe(
      list.children[6]?.querySelector(".agentkit-work-step-title"),
    );
  });

  it("groups a step's calls by what they did and previews four groups", async () => {
    const message = answer([{ type: "text", text: "Done." }]);
    const calls = [
      { name: "web-search", input: { query: "meaning of life" } },
      { name: "web-search", input: { query: "Susan Wolf" } },
      { name: "web-search", input: { query: "Metz" } },
      {
        name: "web-request",
        input: { url: "https://www.plato.stanford.edu/a" },
      },
      {
        name: "web-request",
        input: { url: "https://api.example.com/x", method: "POST" },
      },
      { name: "read-file", input: { path: "src/app/one.ts" } },
      { name: "edit-file", input: { path: "src/app/two.ts" } },
      { name: "bash", input: { command: "pnpm test" } },
      {
        name: "web-request",
        input: { url: "https://doi.org/10.1" },
        status: "failed" as const,
        output: "Error running web-request: HTTP 302 Found",
      },
    ];
    const work = calls.flatMap((call, index) => [
      {
        type: "tool.started" as const,
        occurredAt: at(1_000 + index * 100),
        toolCall: {
          id: `tool-${index}`,
          name: call.name,
          input: call.input,
          status: "running" as const,
        },
      },
      {
        type: "tool.updated" as const,
        occurredAt: at(1_050 + index * 100),
        toolCall: {
          id: `tool-${index}`,
          name: call.name,
          input: call.input,
          status: "status" in call ? call.status : ("completed" as const),
          output: "output" in call ? call.output : "ok",
        },
      },
    ]);
    const container = await renderThread(
      [user, message],
      eventsOf(work, message),
    );
    const step = container.querySelector<HTMLElement>(".agentkit-work-step")!;
    // The only step, with no reasoning before it, needs no title.
    expect(step.querySelector(".agentkit-work-step-title")).toBeNull();
    const groups = () =>
      Array.from(
        step.querySelectorAll<HTMLElement>(".agentkit-work-group"),
        (group) =>
          group.querySelector(".agentkit-work-group-label")?.textContent,
      );
    expect(groups()).toEqual([
      "Searched 3 queries",
      "Read 1 page",
      "Fetched 1 URL",
      "Read 1 file",
      // The failure stays in view past the four-group preview.
      "1 failed",
    ]);
    expect(
      step.querySelector(".agentkit-work-failure-reason")?.textContent,
    ).toBe("HTTP 302 Found");
    const searched = step.querySelector<HTMLElement>(".agentkit-work-group")!;
    expect(
      Array.from(
        searched.querySelectorAll(".agentkit-work-object"),
        (object) => object.textContent,
      ),
    ).toEqual(["meaning of life", "Susan Wolf"]);
    expect(
      searched.querySelector(".agentkit-work-objects-more")?.textContent,
    ).toBe("+1");
    expect(
      step.querySelector('.agentkit-work-group[data-verb="readPages"]')
        ?.textContent,
    ).toContain("plato.stanford.edu");

    const trigger = searched.querySelector<HTMLElement>(
      ".agentkit-work-group-row > .agentkit-disclosure-summary",
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(searched.querySelectorAll(".agentkit-activity-item")).toHaveLength(
      3,
    );

    const more = step.querySelector<HTMLButtonElement>(".agentkit-work-more");
    expect(more?.textContent).toBe("+2 more");
    await click(more);
    expect(groups()).toEqual([
      "Searched 3 queries",
      "Read 1 page",
      "Fetched 1 URL",
      "Read 1 file",
      "Edited 1 file",
      "Ran 1 command",
      "1 failed",
    ]);
    expect(step.querySelector(".agentkit-work-more")).toBeNull();
    // Focus lands on the first group the click revealed.
    expect(document.activeElement?.textContent).toContain("Edited 1 file");
  });

  it("names finished reasoning-only work by how long the turn took", async () => {
    const reasoned = answer([
      { type: "reasoning", text: "Weighing options", visibility: "visible" },
      { type: "text", text: "Answer." },
    ]);
    const delta = (ms: number, text: string) => ({
      type: "reasoning.delta" as const,
      occurredAt: at(ms),
      messageId: reasoned.id,
      text,
    });

    const timed = await renderThread(
      [user, reasoned],
      eventsOf([delta(1_000, "Weighing "), delta(4_000, "options")], reasoned),
      { workedFor: "Trabajó durante {{duration}}" },
    );
    const summary = timed.querySelector<HTMLElement>(
      ".agentkit-activities-summary",
    );
    expect(summary?.textContent).toMatch(/^Trabajó durante \d+s$/);
    // The brain marks live thinking only; a finished row uses the clock.
    expect(
      summary?.querySelector(
        ".agentkit-disclosure-icon-slot .tabler-icon-clock",
      ),
    ).not.toBeNull();
    expect(summary?.querySelector(".tabler-icon-brain")).toBeNull();
    // The thinking is a step inside the row.
    expect(timed.querySelector(".agentkit-work-step")?.textContent).toContain(
      "Weighing options",
    );

    // A reloaded thread has no events: the time is unknown, which must not
    // read as instant.
    const unknown = await renderThread([user, reasoned], []);
    expect(
      unknown.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked");
  });

  describe("a saved reply's reasoning", () => {
    const toolEvents = [
      {
        type: "tool.started" as const,
        occurredAt: at(1_000),
        toolCall: { id: "tool-1", name: "search", status: "running" as const },
      },
      {
        type: "tool.updated" as const,
        occurredAt: at(3_000),
        toolCall: {
          id: "tool-1",
          name: "search",
          status: "completed" as const,
        },
      },
    ];
    // A reloaded run streams no reasoning events, so only the saved message
    // carries its thinking.
    const streamedText = answer([{ type: "text", text: "Answer." }]);

    it("folds reasoning before the answer into the run's one work disclosure", async () => {
      const saved = answer([
        {
          type: "reasoning",
          text: "Checking the result",
          visibility: "visible",
        },
        { type: "text", text: "Answer." },
      ]);
      const container = await renderThread(
        [user, saved],
        eventsOf(toolEvents, streamedText),
      );
      const disclosures = container.querySelectorAll(".agentkit-activities");
      expect(disclosures).toHaveLength(1);
      expect(
        disclosures[0]?.querySelector(".agentkit-activities-summary")
          ?.textContent,
      ).toBe("Worked for 9s");
      const steps = disclosures[0]?.querySelectorAll(
        ".agentkit-work-steps > li",
      );
      // Saved reasoning that names no calls reads after the streamed work.
      expect(steps).toHaveLength(2);
      expect(steps?.[0]?.textContent).toContain("Searched 1 query");
      expect(
        steps?.[1]?.querySelector(".agentkit-work-step-title")?.textContent,
      ).toBe("Checking the result");
      // The finished work sits on the reply's footer line, under the answer.
      expect(
        disclosures[0]?.closest(
          '[data-message-id="assistant-1"] .agentkit-message-actions',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector(
          '[data-message-id="assistant-1"] .agentkit-message-content',
        )?.textContent,
      ).not.toContain("Checking the result");
    });

    it("renders folded reasoning as collapsed rows titled by their bold headings", async () => {
      const saved = answer([
        {
          type: "reasoning",
          text: "**Looking into the docs** I need to gather the **key** pages. **Synthesizing an overview** Then summarize.",
          visibility: "visible",
        },
        { type: "text", text: "Answer." },
      ]);
      const container = await renderThread(
        [user, saved],
        eventsOf(toolEvents, streamedText),
      );
      const disclosure = container.querySelector(".agentkit-activities")!;
      const steps = Array.from(
        disclosure.querySelectorAll<HTMLElement>(".agentkit-work-step"),
      );
      expect(
        steps.map(
          (step) =>
            step.querySelector(".agentkit-work-step-label")?.textContent,
        ),
      ).toEqual([
        "Searching",
        "Looking into the docs",
        "Synthesizing an overview",
      ]);
      expect(steps.every((step) => step.dataset.open === "false")).toBe(true);
      expect(disclosure.textContent).not.toContain("**");

      const toggle = steps[1]!.querySelector<HTMLButtonElement>(
        "button.agentkit-work-step-title",
      )!;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await act(async () => toggle.click());
      expect(steps[1]!.dataset.open).toBe("true");
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      // Inline bold in the body renders as markdown, not literal asterisks.
      expect(steps[1]!.querySelector("strong")?.textContent).toBe("key");
    });

    it("places saved reasoning before the calls it names", async () => {
      const saved = answer([
        {
          type: "reasoning",
          text: "**Looking into the docs** First a search.",
          visibility: "visible",
          toolCallIds: ["tool-1"],
        },
        {
          type: "reasoning",
          text: "**Writing it up** Then the answer.",
          visibility: "visible",
        },
        { type: "text", text: "Answer." },
      ]);
      const container = await renderThread(
        [user, saved],
        eventsOf(toolEvents, streamedText),
      );
      const steps = Array.from(
        container.querySelectorAll<HTMLElement>(".agentkit-work-step"),
      );
      expect(
        steps.map((step) => [
          step.querySelector(".agentkit-work-step-label")?.textContent,
          step.querySelector(".agentkit-work-group-label")?.textContent ?? null,
        ]),
      ).toEqual([
        ["Looking into the docs", "Searched 1 query"],
        ["Writing it up", null],
      ]);
    });

    it("keeps one Worked disclosure for a reply that only reasoned", async () => {
      const saved = answer([
        { type: "reasoning", text: "Thinking it over", visibility: "visible" },
        { type: "text", text: "Answer." },
      ]);
      const container = await renderThread(
        [user, saved],
        eventsOf([], streamedText),
      );
      const disclosures = container.querySelectorAll(".agentkit-activities");
      expect(disclosures).toHaveLength(1);
      expect(
        disclosures[0]?.querySelector(".agentkit-activities-summary")
          ?.textContent,
      ).toMatch(/^Worked/);
    });

    it("leaves reasoning written after the answer began where it was", async () => {
      const saved = answer([
        { type: "text", text: "Answer." },
        { type: "reasoning", text: "Second thoughts", visibility: "visible" },
      ]);
      const container = await renderThread(
        [user, saved],
        eventsOf(toolEvents, streamedText),
      );
      const summaries = Array.from(
        container.querySelectorAll(".agentkit-activities-summary"),
        (summary) => summary.textContent,
      );
      expect(summaries).toEqual(["Worked for 9s", "Worked"]);
    });

    it("does not fold reasoning while the reply is still streaming", async () => {
      const streaming = {
        ...answer([
          { type: "reasoning", text: "Live thinking", visibility: "visible" },
          { type: "text", text: "Answ" },
        ]),
        status: "streaming" as const,
      };
      const container = await renderThread(
        [user, streaming],
        eventsOf(toolEvents, streamedText),
      );
      expect(container.querySelectorAll(".agentkit-activities")).toHaveLength(
        2,
      );
    });
  });

  it("gives the default reasoning part the shared summary", async () => {
    const transport: AgentTransport = {
      async startRun() {
        return { runId: "run-new" };
      },
      async *subscribeToRun() {},
      async cancelRun() {},
    };
    const client = new AgentKitClient({ transport });
    cleanups.push(() => client.shutdown());
    const container = await mount(
      <AgentKitProvider controller={client} threadId={THREAD}>
        <AgentMessagePartView
          threadId={THREAD}
          value={{ type: "reasoning", text: "Private steps" }}
        />
      </AgentKitProvider>,
    );
    const trigger = container.querySelector<HTMLElement>(
      ".agentkit-reasoning-summary",
    );
    expectSharedSummary(trigger);
    expect(container.querySelector("details, summary")).toBeNull();
    await click(trigger);
    expect(
      container.querySelector<HTMLElement>(".agentkit-reasoning")?.dataset.open,
    ).toBe("true");
    expect(container.textContent).toContain("Private steps");
  });
});

describe("work before a message sent into the running turn", () => {
  const preSteerId = `server-${RUN}`;
  const steered: AgentMessage = {
    id: "queued-lee",
    role: "user",
    status: "complete",
    createdAt: at(5_000),
    parts: [{ type: "text", text: "Also greet Lee." }],
  };
  const reply: AgentMessage = {
    id: `server-${RUN}:after:queued-lee`,
    role: "assistant",
    status: "complete",
    createdAt: at(9_000),
    parts: [{ type: "text", text: "Greeted everyone, Lee too." }],
  };
  const greeting = (id: string, startedAt: number, endedAt: number) => [
    {
      type: "tool.started" as const,
      occurredAt: at(startedAt),
      toolCall: { id, name: "hello", status: "running" as const },
    },
    {
      type: "tool.updated" as const,
      occurredAt: at(endedAt),
      toolCall: { id, name: "hello", status: "completed" as const },
    },
  ];
  const runEvents = (
    work: Array<Omit<AgentEvent, "id" | "threadId" | "runId" | "sequence">>,
  ): AgentEvent[] =>
    [
      { type: "run.started", occurredAt: at(0) },
      ...work,
      { type: "run.completed", occurredAt: at(9_500) },
    ].map(
      (event, index) =>
        ({
          ...event,
          id: `steer-event-${index}`,
          threadId: THREAD,
          runId: RUN,
          sequence: index + 1,
        }) as AgentEvent,
    );
  // A reloaded thread: the reply before the steer saved only its tool calls,
  // and the stream never named it.
  const savedEvents = runEvents([
    ...greeting("hello-ada", 1_000, 2_000),
    ...greeting("hello-bo", 2_000, 4_000),
    { type: "message.created", occurredAt: at(5_000), message: steered },
    ...greeting("hello-lee", 6_000, 8_000),
    { type: "message.completed", occurredAt: at(9_000), message: reply },
  ]);
  const toolOnlyReply: AgentMessage = {
    id: preSteerId,
    role: "assistant",
    status: "complete",
    createdAt: at(4_000),
    parts: [
      {
        type: "data",
        mediaType: "application/x-agent-native-repository-part",
        data: { type: "tool-call", toolCallId: "hello-ada", toolName: "hello" },
      },
    ],
  };

  async function renderSteeredThread(
    messages: AgentMessage[],
    events: AgentEvent[],
    slots?: Parameters<typeof AgentKitProvider>[0]["slots"],
  ) {
    const reduced = events.reduce(
      reduceAgentEvent,
      createAgentThreadState(THREAD),
    );
    return mount(
      <AgentKitProvider
        controller={staticController({ ...reduced, messages })}
        threadId={THREAD}
        slots={slots}
      >
        <AgentKitChat composer={false} />
      </AgentKitProvider>,
    );
  }

  for (const [surface, slots] of [
    ["the default message view", undefined],
    ["a host message slot", { message: AgentMessageView }],
  ] as const) {
    it(`renders nothing for the reply segment with no content, through ${surface}`, async () => {
      const container = await renderSteeredThread(
        [user, toolOnlyReply, steered, reply],
        savedEvents,
        slots,
      );

      expect(
        container.querySelector(`[data-message-id="${preSteerId}"]`),
      ).toBeNull();
      expect(
        Array.from(
          container.querySelectorAll("article.agentkit-message"),
          (article) => article.getAttribute("data-message-id"),
        ),
      ).toEqual([user.id, steered.id, reply.id]);
      expect(
        container.querySelectorAll(
          `article[aria-label="Assistant"] .agentkit-message-actions`,
        ),
      ).toHaveLength(1);
    });

    it(`finishes the work before the steer in its own row, through ${surface}`, async () => {
      const container = await renderSteeredThread(
        [user, toolOnlyReply, steered, reply],
        savedEvents,
        slots,
      );
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>(".agentkit-activities"),
      );
      expect(
        rows.map(
          (row) =>
            row.querySelector(".agentkit-activities-summary")?.textContent,
        ),
      ).toEqual(["Worked for 5s", "Worked for 3s"]);
      const steeredArticle = container.querySelector(
        `[data-message-id="${steered.id}"]`,
      )!;
      // The segment has no reply line to carry it, so it stays in place,
      // above the message that ended it.
      expect(rows[0]!.closest(".agentkit-message-actions")).toBeNull();
      expect(
        rows[0]!.compareDocumentPosition(steeredArticle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        rows[1]!.closest(
          `[data-message-id="${reply.id}"] .agentkit-message-actions`,
        ),
      ).not.toBeNull();
    });
  }

  it("finishes a streamed reply segment that only thought and called tools", async () => {
    const thinking: AgentMessage = {
      id: "runtime-before-steer",
      role: "assistant",
      status: "complete",
      createdAt: at(500),
      parts: [
        {
          type: "reasoning",
          text: "Greeting each name.",
          visibility: "visible",
        },
      ],
    };
    const streamed = runEvents([
      {
        type: "message.created",
        occurredAt: at(500),
        message: { ...thinking, parts: [], status: "streaming" },
      },
      {
        type: "reasoning.delta",
        occurredAt: at(600),
        messageId: thinking.id,
        text: "Greeting each name.",
      },
      ...greeting("hello-ada", 1_000, 2_000),
      {
        type: "message.completed",
        occurredAt: at(5_000),
        message: { ...thinking, parts: [] },
      },
      { type: "message.created", occurredAt: at(5_000), message: steered },
      ...greeting("hello-lee", 6_000, 8_000),
      { type: "message.completed", occurredAt: at(9_000), message: reply },
    ]);
    for (const slots of [undefined, { message: AgentMessageView }]) {
      const container = await renderSteeredThread(
        [user, thinking, steered, reply],
        streamed,
        slots,
      );
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>(".agentkit-activities"),
      );

      expect(
        container.querySelector(`[data-message-id="${thinking.id}"]`),
      ).toBeNull();
      expect(rows).toHaveLength(2);
      expect(rows[0]!.closest(".agentkit-message-actions")).toBeNull();
      expect(rows[0]!.textContent).toContain("Greeting each name.");
      expect(
        rows[1]!.closest(
          `[data-message-id="${reply.id}"] .agentkit-message-actions`,
        ),
      ).not.toBeNull();
    }
  });

  it("keeps the work before the steer in its own row while the run continues", async () => {
    const running = runEvents([
      ...greeting("hello-ada", 1_000, 2_000),
      { type: "message.created", occurredAt: at(5_000), message: steered },
      {
        type: "tool.started",
        occurredAt: at(6_000),
        toolCall: { id: "hello-lee", name: "hello", status: "running" },
      },
    ]).filter((event) => event.type !== "run.completed");
    const container = await renderSteeredThread([user, steered], running);
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(".agentkit-activities"),
    );

    expect(rows).toHaveLength(2);
    expect(
      rows[0]!.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 5s");
    expect(rows[1]!.dataset.running).toBe("true");
    expect(
      rows[1]!.compareDocumentPosition(
        container.querySelector(`[data-message-id="${steered.id}"]`)!,
      ) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });
});

describe("a turn that only answered", () => {
  const reply = answer([{ type: "text", text: "Answer." }]);
  // Production runs report this before the model answers; it is not work.
  const startingAgent = {
    type: "activity.started" as const,
    occurredAt: at(100),
    activity: {
      id: `agentkit:internal:${RUN}:starting-agent`,
      kind: "model",
      label: "Starting agent",
      status: "running" as const,
    },
  };

  function answeredAt(
    ms: number,
    work: Array<Omit<AgentEvent, "id" | "threadId" | "runId" | "sequence">>,
    finished = true,
  ): AgentEvent[] {
    return [
      { type: "run.started", occurredAt: at(0) },
      ...work,
      { type: "message.completed", occurredAt: at(ms), message: reply },
      ...(finished
        ? [{ type: "run.completed", occurredAt: at(ms + 500) }]
        : []),
    ].map(
      (event, index) =>
        ({
          ...event,
          id: `event-${index}`,
          threadId: THREAD,
          runId: RUN,
          sequence: index + 1,
        }) as AgentEvent,
    );
  }

  it("shows a plain Worked for row under its reply", async () => {
    for (const work of [[startingAgent], []]) {
      const container = await renderThread(
        [user, reply],
        answeredAt(4_000, work),
      );
      const rows = container.querySelectorAll<HTMLElement>(
        ".agentkit-activities",
      );
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(
        row.querySelector(".agentkit-activities-summary")?.textContent,
      ).toBe("Worked for 4s");
      expect(row.dataset.expandable).toBe("false");
      expect(row.querySelector("button")).toBeNull();
      expect(row.querySelector(".agentkit-disclosure-chevron")).toBeNull();
      expect(row.closest(".agentkit-message-actions")).not.toBeNull();
    }
  });

  it("shows no row under a second, untimed, or still running", async () => {
    const instant = await renderThread(
      [user, reply],
      answeredAt(600, [startingAgent]),
    );
    expect(instant.querySelector(".agentkit-activities")).toBeNull();

    const streaming = await renderThread(
      [user, { ...reply, status: "streaming" }],
      answeredAt(4_000, [startingAgent], false),
    );
    expect(streaming.querySelector(".agentkit-activities")).toBeNull();

    // A reloaded thread has no run timing.
    const reloaded = await renderThread([user, reply], []);
    expect(reloaded.querySelector(".agentkit-activities")).toBeNull();
  });

  it("keeps one expandable row for a turn with activity", async () => {
    const container = await renderThread(
      [user, reply],
      answeredAt(4_000, [startingAgent, ...activityEvents(1)]),
    );
    const rows = container.querySelectorAll<HTMLElement>(
      ".agentkit-activities",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dataset.expandable).toBe("true");
    expectSharedSummary(
      rows[0]!.querySelector<HTMLElement>(".agentkit-disclosure-summary"),
    );
    expect(
      rows[0]!.querySelector(".agentkit-activities-summary")?.textContent,
    ).toBe("Worked for 4s");
  });
});

import type {
  AgentActivity,
  AgentEvent,
  AgentMessage,
  AgentToolCall,
} from "@agent-native/agentkit/protocol";
import { inferAgentActivityKind } from "@agent-native/agentkit/protocol";
import { describe, expect, it } from "vitest";

import {
  agentReasoningSections,
  agentWorkCallObject,
  agentWorkCallVerb,
  agentWorkFailureReason,
  agentWorkSteps,
  agentWorkTimeline,
  type AgentWorkCall,
  type AgentWorkItem,
  type AgentWorkTimelineInput,
} from "./work-steps.js";

const THREAD = "thread-steps";
const RUN = "run-steps";

let sequence = 0;
function event(
  body: Record<string, unknown> & { type: AgentEvent["type"] },
): AgentEvent {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    threadId: THREAD,
    runId: RUN,
    sequence,
    occurredAt: new Date(Date.UTC(2026, 9, 24, 0, 0, sequence)).toISOString(),
    ...body,
  } as AgentEvent;
}

function toolStarted(id: string, name = "web-search"): AgentEvent {
  return event({
    type: "tool.started",
    toolCall: { id, name, status: "running" },
  });
}

function delta(messageId: string, text: string): AgentEvent {
  return event({ type: "reasoning.delta", messageId, text });
}

function reply(
  reasoning: AgentMessage["parts"],
  status: AgentMessage["status"] = "complete",
): AgentMessage {
  return {
    id: "reply",
    role: "assistant",
    status,
    parts: [...reasoning, { type: "text", text: "Answer." }],
  };
}

function timeline(
  events: AgentEvent[],
  messages: AgentMessage[],
  options: Partial<AgentWorkTimelineInput> = {},
) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  return agentWorkTimeline({
    events,
    callIdOf: (candidate) =>
      candidate.type === "tool.started" || candidate.type === "tool.updated"
        ? candidate.toolCall.id
        : undefined,
    reasoningOf: (candidate) =>
      candidate.type === "reasoning.delta"
        ? byId.get(candidate.messageId)
        : undefined,
    ...options,
  });
}

function call(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
  overrides: Partial<AgentToolCall> & {
    activity?: Partial<AgentActivity>;
  } = {},
): AgentWorkCall {
  const { activity, ...tool } = overrides;
  const status = tool.status ?? "completed";
  return {
    id,
    tool: { id, name, input, status, ...tool },
    activity: {
      id,
      kind: inferAgentActivityKind(name),
      label: name,
      status: status === "failed" ? "failed" : status,
      ...activity,
    } as AgentActivity,
  };
}

const callItem = (value: AgentWorkCall): AgentWorkItem => ({
  type: "call",
  call: value,
});
const reasoningItem = (key: string, text: string, active = false) =>
  ({ type: "reasoning", key, text, active }) as const;

describe("agentWorkTimeline", () => {
  it("splits streamed reasoning at the calls made between its deltas", () => {
    const message = reply([
      {
        type: "reasoning",
        text: "**Searching** first. **Reading** next.",
      },
    ]);
    const entries = timeline(
      [
        delta("reply", "**Searching** first. "),
        toolStarted("call-1"),
        toolStarted("call-2"),
        delta("reply", "**Reading** next."),
        toolStarted("call-3"),
      ],
      [message],
    );
    expect(entries).toEqual([
      expect.objectContaining({
        type: "reasoning",
        text: "**Searching** first. ",
        active: false,
      }),
      { type: "call", id: "call-1" },
      { type: "call", id: "call-2" },
      expect.objectContaining({ type: "reasoning", text: "**Reading** next." }),
      { type: "call", id: "call-3" },
    ]);
  });

  it("keeps reasoning whole where it began when its deltas do not rebuild it", () => {
    const message = reply([{ type: "reasoning", text: "Rewritten summary." }]);
    const entries = timeline(
      [
        delta("reply", "Draft "),
        toolStarted("call-1"),
        delta("reply", "summary."),
      ],
      [message],
    );
    expect(entries).toEqual([
      expect.objectContaining({
        type: "reasoning",
        text: "Rewritten summary.",
      }),
      { type: "call", id: "call-1" },
    ]);
  });

  it("drops reasoning a replaced draft discarded and resumes after the kept part", () => {
    const message = reply([
      { type: "reasoning", text: "**Searching** first. " },
      { type: "reasoning", text: "**Checking** receipts." },
    ]);
    const entries = timeline(
      [
        delta("reply", "**Searching** first. "),
        toolStarted("call-1"),
        delta("reply", "**Drafting** an answer."),
        event({
          type: "message.replaced",
          message: {
            id: "reply",
            role: "assistant",
            parts: [{ type: "reasoning", text: "**Searching** first. " }],
          },
        }),
        delta("reply", "**Checking** receipts."),
      ],
      [message],
    );
    expect(entries).toEqual([
      expect.objectContaining({
        type: "reasoning",
        text: "**Searching** first. ",
      }),
      { type: "call", id: "call-1" },
      expect.objectContaining({
        type: "reasoning",
        text: "**Checking** receipts.",
      }),
    ]);
  });

  it("marks only the last chunk of a streaming message active", () => {
    const message = reply(
      [{ type: "reasoning", text: "**One** a. **Two** b." }],
      "streaming",
    );
    const entries = timeline(
      [
        delta("reply", "**One** a. "),
        toolStarted("call-1"),
        delta("reply", "**Two** b."),
      ],
      [message],
    );
    expect(
      entries.flatMap((entry) =>
        entry.type === "reasoning" ? [entry.active] : [],
      ),
    ).toEqual([false, true]);
  });

  it("keeps work before the segment out but still counts its reasoning offsets", () => {
    const message = reply([{ type: "reasoning", text: "Before. After." }]);
    const before = delta("reply", "Before. ");
    const firstCall = toolStarted("call-1");
    const after = delta("reply", "After.");
    const entries = timeline([before, firstCall, after], [message], {
      includes: (candidate) => candidate.sequence > firstCall.sequence,
    });
    expect(entries).toEqual([
      expect.objectContaining({ type: "reasoning", text: "After." }),
    ]);
  });

  it("places saved reasoning before the first call each part names", () => {
    const folded = reply([
      {
        type: "reasoning",
        text: "**Searching** first.",
        toolCallIds: ["call-2", "call-3"],
      },
      { type: "reasoning", text: "**Planning** with no calls." },
      { type: "reasoning", text: "**Reading** next.", toolCallIds: ["call-4"] },
      { type: "reasoning", text: "**Answering** last." },
    ]);
    const entries = timeline(
      ["call-1", "call-2", "call-3", "call-4"].map((id) => toolStarted(id)),
      [],
      { folded },
    );
    expect(
      entries.map((entry) =>
        entry.type === "call" ? entry.id : entry.text.split("**")[1],
      ),
    ).toEqual([
      "call-1",
      "Searching",
      "call-2",
      "call-3",
      "Planning",
      "Reading",
      "call-4",
      "Answering",
    ]);
  });

  it("places reasoning that arrived whole by the calls it names", () => {
    const message = reply([
      {
        type: "reasoning",
        text: "**Searching** first.",
        toolCallIds: ["call-1"],
      },
      { type: "reasoning", text: "**Wrapping up**." },
    ]);
    const completed = event({ type: "message.completed", message });
    const entries = timeline(
      [toolStarted("call-1"), toolStarted("call-2"), completed],
      [message],
      {
        reasoningOf: (candidate) =>
          candidate.type === "message.completed" ? message : undefined,
      },
    );
    // The unanchored part stays where the message itself appeared.
    expect(
      entries.map((entry) =>
        entry.type === "call" ? entry.id : entry.text.split("**")[1],
      ),
    ).toEqual(["Searching", "call-1", "call-2", "Wrapping up"]);
  });

  it("puts saved reasoning without call ids after every streamed call", () => {
    const folded = reply([{ type: "reasoning", text: "Checked it." }]);
    const entries = timeline([toolStarted("call-1")], [], { folded });
    expect(entries.map((entry) => entry.type)).toEqual(["call", "reasoning"]);
  });

  it("drops hidden and whitespace-only reasoning", () => {
    const folded = reply([
      { type: "reasoning", text: "Private", visibility: "hidden" },
      { type: "reasoning", text: "   " },
    ]);
    expect(timeline([toolStarted("call-1")], [], { folded })).toEqual([
      { type: "call", id: "call-1" },
    ]);
  });
});

describe("agentWorkSteps", () => {
  it("opens a step at each reasoning heading with the calls that followed it", () => {
    const steps = agentWorkSteps([
      reasoningItem(
        "r1",
        "**Looking into definitions** I should search. **Planning reads** Then read.",
      ),
      callItem(call("c1", "web-search", { query: "meaning of life" })),
      callItem(call("c2", "web-search", { query: "Susan Wolf" })),
      reasoningItem("r2", "**Reading sources** Now open them."),
      callItem(
        call("c3", "web-request", { url: "https://plato.stanford.edu/x" }),
      ),
    ]);
    expect(
      steps.map((step) => ({
        title: step.title,
        body: step.body,
        groups: step.groups.map((group) => [group.verb, group.calls.length]),
      })),
    ).toEqual([
      {
        title: "Looking into definitions",
        body: "I should search.",
        groups: [],
      },
      {
        title: "Planning reads",
        body: "Then read.",
        groups: [["searched", 2]],
      },
      {
        title: "Reading sources",
        body: "Now open them.",
        groups: [["readPages", 1]],
      },
    ]);
  });

  it("collects calls before any reasoning into one untitled step", () => {
    const steps = agentWorkSteps([
      callItem(call("c1", "web-search", { query: "a" })),
      callItem(call("c2", "web-request", { url: "https://a.dev" })),
      callItem(call("c3", "web-search", { query: "b" })),
      reasoningItem("r1", "**Writing** it up."),
    ]);
    expect(steps[0]).toMatchObject({
      key: "lead",
      title: undefined,
      dominantVerb: "searched",
      callCount: 3,
    });
    expect(steps[1]?.title).toBe("Writing");
  });

  it("titles reasoning without a heading by its first sentence, as plain text", () => {
    const [step] = agentWorkSteps([
      reasoningItem(
        "r1",
        "I need **primary** sources first. Then compare `views`.",
      ),
    ]);
    expect(step?.title).toBe("I need primary sources first.");
    expect(step?.body).toBe(
      "I need **primary** sources first. Then compare `views`.",
    );
    // A body that is only its title has nothing more to expand.
    const [short] = agentWorkSteps([reasoningItem("r2", "Checking.")]);
    expect(short?.title).toBe("Checking.");
    expect(short?.body).toBe("");
  });

  it("groups calls by what they did, not by tool, keeping first-seen order", () => {
    const [step] = agentWorkSteps(
      [
        call("c1", "web-search", { query: "one" }),
        call("c2", "docs-search", { query: "two" }),
        call("c3", "read-file", { path: "src/a.ts" }),
        call("c4", "web-search", { query: "one" }),
        call("c5", "edit-file", { filePath: "src/b.ts" }),
        call("c6", "bash", { command: "pnpm test" }),
        call("c7", "update-document", { title: "Notes" }),
        call("c8", "list-designs"),
        call("c9", "list-designs"),
        call("c10", "web-request", {
          url: "https://api.dev/x",
          method: "POST",
        }),
      ].map(callItem),
    );
    expect(
      step?.groups.map((group) => [
        group.verb,
        group.calls.length,
        group.objects.map((object) => object.text),
      ]),
    ).toEqual([
      ["searched", 3, ["one", "two"]],
      ["readFiles", 1, ["a.ts"]],
      ["edited", 1, ["b.ts"]],
      ["ranCommands", 1, ["pnpm test"]],
      ["ranActions", 1, []],
      ["used", 2, []],
      ["fetched", 1, ["api.dev"]],
    ]);
  });

  it("keeps calls from different integrations, agents and tools apart", () => {
    const slack = { ...call("c1", "provider-api-request"), sourceId: "slack" };
    const gong = { ...call("c2", "provider-api-request"), sourceId: "gong" };
    const delegated = call(
      "c3",
      "web-search",
      { query: "x" },
      {
        activity: { agentId: "agent-1" },
      },
    );
    const [step] = agentWorkSteps(
      [slack, gong, delegated, call("c4", "web-search", { query: "y" })].map(
        callItem,
      ),
    );
    expect(step?.groups).toHaveLength(4);
  });

  it("never merges a call a host renderer owns", () => {
    const owned = {
      ...call("c1", "web-search", { query: "x" }),
      standalone: true,
    };
    const [step] = agentWorkSteps(
      [owned, call("c2", "web-search", { query: "y" })].map(callItem),
    );
    expect(step?.groups.map((group) => group.standalone)).toEqual([
      true,
      false,
    ]);
  });

  it("groups failures apart by reason, and their counts add up to the step's", () => {
    const failed = (id: string, output: string) =>
      call(id, "web-search", { query: id }, { status: "failed", output });
    const [step] = agentWorkSteps(
      [
        call("ok", "web-search", { query: "fine" }),
        failed("f1", "Skipped web-search: budget exhausted. Stop now."),
        failed("f2", "Skipped web-search: budget exhausted. Try later."),
        call(
          "f3",
          "web-request",
          { url: "https://doi.org/1" },
          {
            status: "failed",
            output: "Error running web-request: HTTP 302 Found\n\nRedirect: x",
          },
        ),
      ].map(callItem),
    );
    expect(
      step?.groups.map((group) => [
        group.verb,
        group.failed,
        group.reason ?? null,
        group.calls.length,
      ]),
    ).toEqual([
      ["searched", false, null, 1],
      ["searched", true, "Skipped web-search: budget exhausted", 2],
      ["readPages", true, "HTTP 302 Found", 1],
    ]);
    expect(step?.failedCount).toBe(3);
    expect(
      step?.groups
        .filter((group) => group.failed)
        .reduce((sum, group) => sum + group.calls.length, 0),
    ).toBe(step?.failedCount);
  });

  it("keeps activities without a tool under the label their producer wrote", () => {
    const activity: AgentActivity = {
      id: "a1",
      kind: "search",
      label: "Docs search",
      status: "completed",
    };
    const [step] = agentWorkSteps([
      { type: "call", call: { id: "a1", activity } },
      { type: "call", call: { id: "a2", activity: { ...activity, id: "a2" } } },
    ]);
    expect(
      step?.groups.map((group) => [group.verb, group.calls.length]),
    ).toEqual([["used", 2]]);
  });

  it("shows a streaming step as running and keeps its key as text grows", () => {
    const first = agentWorkSteps([
      reasoningItem("r1", "**Searching** for", true),
      callItem(call("c1", "web-search", { query: "a" }, { status: "running" })),
    ]);
    const later = agentWorkSteps([
      reasoningItem("r1", "**Searching** for sources now.", true),
      callItem(call("c1", "web-search", { query: "a" })),
      callItem(call("c2", "web-search", { query: "b" }, { status: "running" })),
    ]);
    expect(first[0]).toMatchObject({ active: true, running: true });
    expect(first[0]?.groups[0]?.running).toBe(true);
    expect(later[0]?.key).toBe(first[0]?.key);
    expect(later[0]?.groups[0]?.key).toBe(first[0]?.groups[0]?.key);
    expect(later[0]?.groups[0]?.calls).toHaveLength(2);
  });
});

describe("agentWorkCallObject and agentWorkCallVerb", () => {
  it("reads queries, page domains, file names and commands from tool input", () => {
    expect(
      agentWorkCallObject(call("c", "web-search", { query: " a  b " })),
    ).toEqual({ kind: "query", text: "a b" });
    expect(
      agentWorkCallObject(
        call("c", "web-request", { url: "https://www.iep.utm.edu/x" }),
      ),
    ).toEqual({ kind: "url", text: "iep.utm.edu" });
    expect(
      agentWorkCallObject(call("c", "read", { path: "/repo/src/app.tsx" })),
    ).toEqual({ kind: "file", text: "app.tsx" });
    expect(
      agentWorkCallObject(call("c", "bash", { command: "ls -la" })),
    ).toEqual({ kind: "command", text: "ls -la" });
    // A JSON string input is read the same way; anything else has no object.
    expect(
      agentWorkCallObject(call("c", "web-search", '{"query":"json"}' as never)),
    ).toEqual({ kind: "query", text: "json" });
    expect(agentWorkCallObject(call("c", "web-search", "plain" as never))).toBe(
      undefined,
    );
    expect(
      agentWorkCallObject(call("c", "web-request", { url: "ftp://files" })),
    ).toBe(undefined);
  });

  it("reads JSON responses and non-GET requests as fetches", () => {
    expect(
      agentWorkCallVerb(
        call("c", "web-request", {
          url: "https://a.dev",
          responseMode: "json",
        }),
      ),
    ).toBe("fetched");
    expect(
      agentWorkCallVerb(call("c", "web-request", { url: "https://a.dev" })),
    ).toBe("readPages");
  });
});

describe("agentWorkFailureReason", () => {
  it("prefers the HTTP status, then the first sentence of the first line", () => {
    expect(
      agentWorkFailureReason(
        call(
          "c",
          "x",
          {},
          { status: "failed", output: "Error: Timed out. Retry." },
        ),
      ),
    ).toBe("Timed out");
    expect(
      agentWorkFailureReason(
        call(
          "c",
          "x",
          {},
          {
            status: "failed",
            error: {
              code: "e",
              message:
                "request failed: HTTP 404 Not Found (errorCode: http_404)",
            },
          },
        ),
      ),
    ).toBe("HTTP 404 Not Found");
    expect(
      agentWorkFailureReason(
        call(
          "c",
          "x",
          {},
          { status: "failed", output: { code: "structured" } },
        ),
      ),
    ).toBe(undefined);
  });
});

describe("agentReasoningSections", () => {
  it("splits at bold headings that start a line or follow a sentence", () => {
    expect(
      agentReasoningSections(
        "Lead in. **First** body with **inline** bold. **Second**\nMore.",
      ),
    ).toEqual([
      { body: "Lead in." },
      { heading: "First", body: "body with **inline** bold." },
      { heading: "Second", body: "More." },
    ]);
  });
});

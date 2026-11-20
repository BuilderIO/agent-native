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
  agentWorkSources,
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
    ).toEqual({
      kind: "url",
      text: "iep.utm.edu",
      uri: "https://www.iep.utm.edu/x",
    });
    expect(
      agentWorkCallObject(call("c", "read", { path: "/repo/src/app.tsx" })),
    ).toEqual({ kind: "file", text: "app.tsx", id: "/repo/src/app.tsx" });
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

  it("names a page read by the title and link its result returned", () => {
    const read = call(
      "c",
      "get-document",
      { id: "doc-1" },
      {
        output: {
          id: "doc-1",
          title: "Launch plan",
          deepLink: "/page/doc-1",
          content: "Body.",
        },
      },
    );
    expect(agentWorkCallObject(read)).toEqual({
      kind: "document",
      text: "Launch plan",
      id: "doc-1",
      uri: "/page/doc-1",
    });
    expect(agentWorkCallVerb(read)).toBe("readDocuments");
    expect(
      agentWorkCallObject(
        call(
          "c",
          "get-document",
          {},
          {
            output: JSON.stringify({
              document: { documentId: "d", name: "Notes" },
            }),
          },
        ),
      ),
    ).toEqual({ kind: "document", text: "Notes", id: "d" });
    expect(
      agentWorkCallObject(
        call(
          "c",
          "read-page",
          { url: "https://content.example/p/d" },
          { output: { id: "d", title: "Roadmap", deepLink: "/p/d" } },
        ),
      ),
    ).toEqual({ kind: "document", text: "Roadmap", id: "d", uri: "/p/d" });
    expect(
      agentWorkCallObject(
        call(
          "c",
          "get-document",
          {},
          { status: "failed", output: { id: "d", title: "Draft" } },
        ),
      ),
    ).toBe(undefined);
    expect(
      agentWorkCallObject(
        call("c", "get-document", {}, { output: { title: "Draft" } }),
      ),
    ).toBe(undefined);
    expect(
      agentWorkCallObject(
        call(
          "c",
          "update-document",
          {},
          { output: { id: "d", title: "Draft" } },
        ),
      ),
    ).toBe(undefined);
  });
});

describe("agentWorkSources", () => {
  it("lists each source once in call order and leaves out other work", () => {
    const page = { output: { id: "d1", title: "Launch plan" } };
    const { sources, failures } = agentWorkSources([
      call("a", "get-document", { id: "d1" }, page),
      call("b", "web-search", { query: "pricing" }),
      call("c", "get-document", { id: "d1" }, page),
      call("d", "web-request", { url: "https://a.dev/x" }),
      call("e", "web-request", { url: "https://a.dev/y" }),
      call("f", "read", { path: "/repo/notes.md" }),
      call("g", "bash", { command: "ls" }),
      call("h", "update-document", { id: "d1" }),
      call("i", "get-document", { id: "d2" }, { status: "running" }),
    ]);
    expect(sources.map(({ kind, text, uri }) => ({ kind, text, uri }))).toEqual(
      [
        { kind: "document", text: "Launch plan", uri: undefined },
        { kind: "search", text: "pricing", uri: undefined },
        { kind: "web", text: "a.dev", uri: "https://a.dev/x" },
        { kind: "web", text: "a.dev", uri: "https://a.dev/y" },
        { kind: "file", text: "notes.md", uri: undefined },
      ],
    );
    expect(failures).toEqual([]);
  });

  it("tells sources apart by id and path, not by the name they show", () => {
    const { sources, failures } = agentWorkSources([
      call(
        "a",
        "get-document",
        { id: "a" },
        { output: { id: "a", title: "Notes" } },
      ),
      call(
        "b",
        "get-document",
        { id: "b" },
        { output: { id: "b", title: "Notes" } },
      ),
      call(
        "c",
        "view-screen",
        {},
        { output: { document: { id: "d", title: "Plan" } } },
      ),
      call(
        "d",
        "get-document",
        { id: "d" },
        { output: { id: "d", title: "Plan", deepLink: "/p/d" } },
      ),
      call("e", "read", { path: "/a/notes.md" }),
      call("f", "read", { path: "/b/notes.md" }),
      call(
        "g",
        "get-document",
        { id: "x" },
        { status: "failed", output: "Not found" },
      ),
      call(
        "h",
        "get-document",
        { id: "y" },
        { status: "failed", output: "Not found" },
      ),
    ]);
    expect(sources.map(({ kind, text, uri }) => ({ kind, text, uri }))).toEqual(
      [
        { kind: "document", text: "Notes", uri: undefined },
        { kind: "document", text: "Notes", uri: undefined },
        { kind: "document", text: "Plan", uri: "/p/d" },
        { kind: "file", text: "notes.md", uri: undefined },
        { kind: "file", text: "notes.md", uri: undefined },
      ],
    );
    expect(failures).toHaveLength(2);
  });

  it("keeps the same page read through two integrations apart", () => {
    const page = { output: { id: "d", title: "Plan" } };
    const { sources } = agentWorkSources([
      { ...call("a", "get-document", { id: "d" }, page), sourceId: "content" },
      { ...call("b", "get-document", { id: "d" }, page), sourceId: "notion" },
      { ...call("c", "get-document", { id: "d" }, page), sourceId: "notion" },
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Plan", "Plan"]);
  });

  it("drops a failed read that a later call read after all", () => {
    const { sources, failures } = agentWorkSources([
      call(
        "a",
        "get-document",
        { id: "d" },
        { status: "failed", output: "Timed out" },
      ),
      call(
        "b",
        "get-document",
        { id: "d" },
        { output: { id: "d", title: "Plan" } },
      ),
      call(
        "c",
        "web-request",
        { url: "https://a.dev/x" },
        { status: "failed", output: "HTTP 503" },
      ),
      call("d", "web-request", { url: "https://a.dev/x" }),
      call(
        "e",
        "get-document",
        { id: "e" },
        { status: "failed", output: "Not found" },
      ),
      call(
        "f",
        "read",
        { url: "https://content.example/p/r" },
        { status: "failed", output: "Timed out" },
      ),
      call(
        "g",
        "read-page",
        { url: "https://content.example/p/r" },
        { output: { id: "r", title: "Roadmap" } },
      ),
      call(
        "h",
        "get-document",
        { id: "untitled" },
        { status: "failed", output: "Timed out" },
      ),
      call(
        "i",
        "get-document",
        { id: "untitled" },
        { output: { id: "untitled" } },
      ),
      call(
        "j",
        "get-document",
        { id: "roadmap" },
        { status: "failed", output: "Denied" },
      ),
      call("k", "search-documents", { query: "roadmap" }),
    ]);
    expect(sources.map(({ text }) => text)).toEqual([
      "Plan",
      "a.dev",
      "Roadmap",
      "roadmap",
    ]);
    expect(failures.map(({ reason }) => reason)).toEqual([
      "Not found",
      "Denied",
    ]);
  });

  it("never counts writes or navigation as sources, even with addresses", () => {
    const { sources, failures } = agentWorkSources([
      call("a", "create-content-webhook", {
        url: "https://hooks.example/events",
        documentId: "d",
      }),
      call("b", "navigate", { path: "/p/d" }),
      call(
        "c",
        "create-content-webhook",
        { url: "https://hooks.example/events" },
        { status: "failed", output: "Denied" },
      ),
      call("d", "edit-document", { query: "launch" }),
      call("e", "web-request", { url: "https://a.dev/hook", method: "POST" }),
      call("g", "register-hook", { url: "https://hooks.example/events" }),
      call(
        "f",
        "web-request",
        { url: "https://a.dev/hook", method: "put" },
        { status: "failed", output: "HTTP 500" },
      ),
    ]);
    expect(sources).toEqual([]);
    expect(failures).toEqual([]);
  });

  it("counts a read with a method input as a source when it names no address", () => {
    const { sources } = agentWorkSources([
      call("a", "search-request-logs", { query: "checkout", method: "POST" }),
      call(
        "b",
        "get-document",
        { id: "d1", method: "markdown" },
        { output: { id: "d1", title: "Launch plan" } },
      ),
      call("c", "list-transactions", { query: "refunds", method: "card" }),
      call("d", "web-request", { url: "https://a.dev/hook", method: "POST" }),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["search", "checkout"],
      ["document", "Launch plan"],
      ["search", "refunds"],
    ]);
  });

  it("clears a failed page read when another page tool reads it without a title", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { failures } = agentWorkSources([
      call("a", "get-document", { id: "x" }, failed),
      call("b", "read-page", { id: "x" }, { output: { id: "x" } }),
      call("c", "get-note", { id: "n" }, failed),
      call("d", "get-doc", { id: "n" }, { output: { id: "n" } }),
    ]);
    expect(failures.map(({ kind, reason }) => [kind, reason])).toEqual([
      ["document", "Timed out"],
    ]);
  });

  it("lists an activity without a tool by the page or query it names", () => {
    const activity = (
      id: string,
      kind: AgentActivity["kind"],
      object: NonNullable<AgentActivity["object"]>,
      status: AgentActivity["status"] = "completed",
    ): AgentWorkCall => ({
      id,
      activity: { id, kind, label: `${kind} ${id}`, status, object },
    });
    const { sources, failures } = agentWorkSources([
      activity("a", "read", {
        id: "d1",
        kind: "document",
        label: "Launch plan",
        uri: "https://docs.example/d1",
      }),
      activity("b", "search", { id: "q1", kind: "query", label: "pricing" }),
      activity(
        "c",
        "read",
        { id: "d2", kind: "document", label: "Roadmap" },
        "failed",
      ),
    ]);
    expect(sources.map(({ kind, text, uri }) => [kind, text, uri])).toEqual([
      ["document", "Launch plan", "https://docs.example/d1"],
      ["search", "pricing", undefined],
    ]);
    expect(failures.map(({ kind, text }) => [kind, text])).toEqual([
      ["document", "Roadmap"],
    ]);
  });

  it("keeps an MCP tool's verb when its server is named with the same word", () => {
    const { sources, failures } = agentWorkSources([
      call("a", "mcp__search__search_documents", { query: "pricing" }),
      call(
        "b",
        "mcp__fetch__fetch_page",
        { id: "p" },
        { status: "failed", output: "Denied" },
      ),
      call("c", "mcp__notion__notion_search", { query: "roadmap" }),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["search", "pricing"],
      ["search", "roadmap"],
    ]);
    expect(failures.map(({ kind, reason }) => [kind, reason])).toEqual([
      ["document", "Denied"],
    ]);
  });

  it("clears a failed page activity without a tool when a page tool reads it", () => {
    const missed = (id: string, label: string): AgentWorkCall => ({
      id: `missed-${id}`,
      activity: {
        id: `missed-${id}`,
        kind: "read",
        label: `Read ${label}`,
        status: "failed",
        object: { id, kind: "document", label },
      },
    });
    const read = (id: string, title: string) =>
      call(`read-${id}`, "get-document", { id }, { output: { id, title } });
    expect(
      agentWorkSources([missed("d2", "Roadmap"), read("d2", "Roadmap")])
        .failures,
    ).toEqual([]);
    expect(
      agentWorkSources([missed("d2", "Roadmap"), read("d9", "Roadmap")])
        .failures,
    ).toHaveLength(1);
  });

  it("clears a failed activity without a tool when the same activity succeeds", () => {
    const activity = (
      id: string,
      label: string,
      status: AgentActivity["status"],
    ): AgentWorkCall => ({
      id,
      activity: { id, kind: "search", label, status },
    });
    const failed = activity("a", "Searched the web", "failed");
    expect(agentWorkSources([failed]).failures).toHaveLength(1);
    expect(
      agentWorkSources([
        failed,
        activity("b", "Searched the docs", "completed"),
      ]).failures,
    ).toHaveLength(1);
    expect(
      agentWorkSources([failed, activity("c", "Searched the web", "completed")])
        .failures,
    ).toEqual([]);
  });

  it("never counts tools named for a write, even with read or search words", () => {
    const failed = { status: "failed" as const, output: "Denied" };
    const { sources, failures } = agentWorkSources([
      call("a", "delete-query", { query: "old" }),
      call(
        "b",
        "save-dashboard-view",
        { id: "v" },
        { output: { id: "v", title: "Weekly" } },
      ),
      call("c", "markRead", { id: "m" }, failed),
      call("d", "set-search-params", { search: "q" }),
      call("e", "update-list", { url: "https://a.dev/list" }, failed),
      call("f", "get-update-notes", { query: "launch" }),
      call("g", "track-page-view", { url: "https://a.dev/pricing" }),
      call("h", "notify-viewers", { id: "v" }, failed),
      call("i", "search-replace", { query: "a", replacement: "b" }),
      call("j", "find-replace", { pattern: "x" }),
      call("k", "web-search", { query: "y", replaceWith: "z" }),
      call("l", "web-request", { url: "https://a.dev/hook" }, failed),
      call("m", "list-content-webhook-create", { url: "https://a.dev/hook" }),
      call("n", "mcp__crm__get_contact_update", { query: "ann" }),
      call("o", "get-latest-post", { query: "news" }),
      call("p", "file-mark-read", { path: "notes/a.md" }),
      call("q", "notification-mark-read", { url: "https://a.dev/n/1" }, failed),
      call("r", "pin-search-result", { query: "pricing" }),
      call("s", "favorite-search", { query: "launch plan" }),
      call("t", "get-bookmark", { query: "tabs" }),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["search", "launch"],
      ["search", "news"],
      ["search", "tabs"],
    ]);
    expect(failures.map(({ kind, label }) => [kind, label])).toEqual([
      ["web", "web-request"],
    ]);
  });

  it("keeps a failure that comes after an earlier read of the same thing", () => {
    const failed = { status: "failed" as const, output: "Denied" };
    const page = { output: { id: "x", title: "Plan" } };
    const { sources, failures } = agentWorkSources([
      call("a", "get-document", { id: "x" }, page),
      call("b", "get-document", { id: "x" }, failed),
      call("c", "get-document", { id: "y" }, failed),
      call("d", "get-document", { id: "y" }, { output: { id: "y" } }),
      call(
        "e",
        "get-document",
        { id: "y" },
        { status: "failed", output: "Gone" },
      ),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Plan"]);
    expect(failures.map(({ reason }) => reason)).toEqual(["Denied", "Gone"]);
  });

  it("keeps failed reads and searches with their reasons, once each", () => {
    const failed = (output: string) => ({ status: "failed" as const, output });
    const { sources, failures } = agentWorkSources([
      call(
        "a",
        "search-documents",
        { query: "roadmap" },
        failed("Error: Timed out."),
      ),
      call("b", "get-document", { id: "d2" }, failed("Error: Not found.")),
      call("c", "get-document", { id: "d2" }, failed("Error: Not found.")),
      call("d", "web-request", { url: "https://a.dev/x" }, failed("HTTP 403")),
      call("e", "update-document", { id: "d2" }, failed("Error: Denied.")),
    ]);
    expect(sources).toEqual([]);
    expect(failures.map(({ key: _key, ...failure }) => failure)).toEqual([
      {
        kind: "search",
        text: "roadmap",
        label: "search-documents",
        reason: "Timed out",
      },
      { kind: "document", label: "get-document", reason: "Not found" },
      {
        kind: "web",
        text: "a.dev",
        label: "web-request",
        reason: "HTTP 403",
      },
    ]);
  });

  it("names reads that arrive as activities without a tool call", () => {
    const activity = (
      id: string,
      overrides: Partial<AgentActivity>,
    ): AgentWorkCall => ({
      id,
      activity: {
        id,
        kind: "read",
        label: `Read ${id}`,
        status: "completed",
        ...overrides,
      } as AgentActivity,
    });
    const { sources, failures } = agentWorkSources([
      activity("a", {
        object: {
          id: "a",
          kind: "url",
          label: "Doc",
          uri: "https://a.dev/doc",
        },
      }),
      activity("b", {
        object: { id: "b", kind: "file", label: "/repo/plan.md" },
      }),
      activity("c", { kind: "search", label: "Docs search" }),
      activity("d", {
        status: "failed",
        object: { id: "d", kind: "file", label: "/repo/gone.md" },
        detail: "Not found",
      }),
      activity("e", {
        kind: "edit",
        object: { id: "e", kind: "file", label: "/x.md" },
      }),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["web", "a.dev"],
      ["file", "plan.md"],
    ]);
    expect(
      failures.map(({ kind, text, reason }) => [kind, text, reason]),
    ).toEqual([["file", "gone.md", "Not found"]]);
  });

  it("keeps a file a file when its contents look like a page", () => {
    const { sources } = agentWorkSources([
      call(
        "a",
        "read",
        { path: "/repo/data.json" },
        { output: { id: "r1", name: "config" } },
      ),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["file", "data.json"],
    ]);
  });

  it("clears a failure when the same call succeeds, whatever its input names", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources([
      call("a", "get-document", { title: "Plan", depth: 1 }, failed),
      call(
        "b",
        "get-document",
        { depth: 1, title: "Plan" },
        { output: { id: "p", title: "Plan" } },
      ),
      call("c", "get-document", { title: "Other" }, failed),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Plan"]);
    expect(failures.map(({ label }) => label)).toEqual(["get-document"]);
  });

  it("counts MCP reads and searches by the tool name after the server", () => {
    const failed = { status: "failed" as const, output: "Denied" };
    const { sources, failures } = agentWorkSources([
      call("a", "mcp__notion__notion-search", { query: "roadmap" }),
      call("b", "mcp__notion__notion-update-view", { query: "x" }),
      call("c", "mcp__slack__send_message", { query: "hi" }, failed),
      call("d", "mcp__confluence__get_page", { id: "z" }, failed),
      call("e", "mcp__github__search_open_issues", { query: "crash" }),
      call("f", "mcp__wordpress__get_post", { url: "https://blog.dev/p" }),
      call("g", "mcp__notion__get-update-notes", { query: "launch" }),
      call("h", "mcp__slack__slack_send_message", { query: "yo" }),
      call("i", "mcp__tracker__issue_update_list", { query: "q" }),
      call("j", "mcp__crm__get_or_create_contact", { query: "ann" }),
      call("k", "mcp__files__find_and_replace", { path: "/a.md" }),
      call(
        "l",
        "get-or-create-page",
        { id: "n" },
        { output: { id: "n", title: "New" } },
      ),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["search", "roadmap"],
      ["search", "crash"],
      ["web", "blog.dev"],
      ["search", "launch"],
    ]);
    expect(failures.map(({ kind, label }) => [kind, label])).toEqual([
      ["document", "mcp__confluence__get_page"],
    ]);
  });

  it("names a search by its own search-term key, never by a filter", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const slack = "mcp__slack__search_messages";
    const { sources, failures } = agentWorkSources([
      call("e", slack, { channel: "general", text: "deploy" }),
      call("f", slack, { channel: "general" }, failed),
      call("g", slack, { channel: "general", text: "ship" }),
      call("a", "mcp__jira__search_issues", { cloudId: "c1", jql: "p = OPS" }),
      call(
        "b",
        "mcp__jira__search_issues",
        { cloudId: "c1", jql: "p = WEB" },
        failed,
      ),
      call(
        "c",
        "mcp__jira__search_issues",
        { cloudId: "c1", jql: "p = API" },
        failed,
      ),
      call("d", "mcp__jira__search_issues", { jql: "p = API", cloudId: "c1" }),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["search", "deploy"],
      ["search", "ship"],
      ["search", "p = OPS"],
      ["search", "p = API"],
    ]);
    expect(failures.map(({ kind, text }) => [kind, text])).toEqual([
      ["search", undefined],
      ["search", "p = WEB"],
    ]);
  });

  it("clears a failed search only with the same terms and filters", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const slack = "mcp__slack__search_messages";
    const jira = "mcp__jira__search_issues";
    const { sources, failures } = agentWorkSources([
      call("a", slack, { channel: "eng", text: "launch" }, failed),
      call("b", slack, { channel: "general", text: "launch" }),
      call("c", jira, { cloudId: "c1", jql: "p = API" }, failed),
      call("d", jira, { jql: "p = API", limit: 5 }),
      call("e", "search-documents", { query: "plan", limit: 5 }, failed),
      call("f", "search-documents", { limit: 5, query: "plan" }),
    ]);
    expect(sources.map(({ text }) => text)).toEqual([
      "launch",
      "p = API",
      "plan",
    ]);
    expect(failures.map(({ label, text }) => [label, text])).toEqual([
      [slack, "launch"],
      [jira, "p = API"],
    ]);
  });

  it("leaves out tool discovery searches", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources([
      call("a", "tool-search", { query: "calendar" }),
      call("b", "mcp__content__tool-search", { query: "pages" }, failed),
      call("c", "search-documents", { query: "pricing" }),
      call("d", "mcp__content__search-actions", { query: "docs" }),
      call("e", "search-actions", { query: "docs" }, failed),
      call("f", "get-script-run", { runId: "r1" }, failed),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["pricing"]);
    expect(failures).toEqual([]);
  });

  it("lets the run's later calls clear failures without listing them", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources(
      [
        call("a", "get-document", { id: "p" }, failed),
        call("b", "web-search", { query: "pricing" }, failed),
      ],
      [
        call(
          "c",
          "get-document",
          { id: "p" },
          { output: { id: "p", title: "Plan" } },
        ),
        call("d", "web-search", { query: "other" }, failed),
      ],
    );
    expect(sources).toEqual([]);
    expect(failures.map(({ text }) => text)).toEqual(["pricing"]);
  });

  it("matches searches by their exact terms, showing them on one line", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources([
      call("a", "search-records", { query: "name = 'A  B'" }, failed),
      call("b", "search-records", { query: "name = 'A B'" }),
      call("c", "search-records", { query: " name = 'A B' " }),
      call("d", "search-records", { query: "name  =  'A B'" }),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["name = 'A B'"]);
    expect(failures.map(({ text }) => text)).toEqual(["name = 'A B'"]);
  });

  it("clears a failed page read when another tool reads that page", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources([
      call("a", "get-document", { id: "p" }, failed),
      call(
        "b",
        "fetch-document",
        { documentId: "p" },
        { output: { id: "p", title: "Plan" } },
      ),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Plan"]);
    expect(failures).toEqual([]);
  });

  it("keeps failures of the same tool with different inputs apart", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { failures } = agentWorkSources([
      call("a", "get-document", { title: "Plan" }, failed),
      call("b", "get-document", { title: "Budget" }, failed),
      call(
        "c",
        "get-document",
        { title: "Plan" },
        { output: { id: "p", title: "Plan" } },
      ),
    ]);
    expect(failures).toHaveLength(1);
  });

  it("counts retrieve and describe tools as reads", () => {
    const failed = { status: "failed" as const, output: "Not found" };
    const { sources, failures } = agentWorkSources([
      call(
        "a",
        "mcp__notion__retrieve_page",
        { id: "p" },
        { output: { id: "p", title: "Plan" } },
      ),
      call("b", "mcp__notion__retrieve_page", { id: "q" }, failed),
      call(
        "c",
        "retrieve-document",
        { id: "d" },
        { output: { id: "d", title: "Draft" } },
      ),
      call("d", "mcp__docs__describe_page", { id: "r" }, failed),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Plan", "Draft"]);
    expect(failures.map(({ kind, label }) => [kind, label])).toEqual([
      ["document", "mcp__notion__retrieve_page"],
      ["document", "mcp__docs__describe_page"],
    ]);
  });

  it("keeps pages with the same id but different titles apart", () => {
    const record = (name: string) => ({ output: { id: "1", name } });
    const { sources } = agentWorkSources([
      call("a", "get-note", { id: "1" }, record("Ann")),
      call("b", "get-doc", { id: "1" }, record("Apollo")),
      call("c", "get-note", { id: "1" }, record("Ann")),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Ann", "Apollo"]);
  });

  it("keeps notes and documents with the same id and title apart", () => {
    const record = { output: { id: "1", title: "Ann" } };
    const { sources } = agentWorkSources([
      call("a", "get-note", { id: "1" }, record),
      call("b", "get-doc", { id: "1" }, record),
      call("c", "read-page", { id: "1" }, record),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Ann", "Ann"]);
  });

  it("shows a page that failed through two page tools once", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const attempts = [
      call("a", "get-document", { id: "p" }, failed),
      call("b", "read-page", { documentId: "p" }, failed),
      call("c", "get-note", { id: "p" }, failed),
    ];
    const labels = (calls: typeof attempts) =>
      agentWorkSources(calls).failures.map(({ label }) => label);
    expect(labels(attempts)).toEqual(["get-document", "get-note"]);
    const read = call(
      "d",
      "read-page",
      { id: "p" },
      { output: { id: "p", title: "Plan" } },
    );
    expect(labels([...attempts, read])).toEqual(["get-note"]);
  });

  it("clears a failed page lookup by title when a read returns that page", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources([
      call("a", "get-document", { title: "pricing" }, failed),
      call("b", "get-document", { title: "Roadmap" }, failed),
      call("c", "get-document", { id: "p2" }, failed),
      call("d", "get-note", { name: "Pricing" }, failed),
      call(
        "e",
        "get-document",
        { id: "p1" },
        { output: { id: "p1", title: "Pricing" } },
      ),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Pricing"]);
    expect(failures.map(({ label }) => label)).toEqual([
      "get-document",
      "get-document",
      "get-note",
    ]);
  });

  it("shows a page lookup by title that failed twice the same way once", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const attempts = [
      call("a", "get-document", { title: "Pricing", depth: 1 }, failed),
      call("b", "get-document", { title: "pricing", depth: 2 }, failed),
    ];
    expect(agentWorkSources(attempts).failures).toHaveLength(1);
    const read = call(
      "c",
      "read-page",
      { id: "p1" },
      { output: { id: "p1", title: "Pricing" } },
    );
    expect(agentWorkSources([...attempts, read]).failures).toEqual([]);
  });

  it("clears a failed page read only with a read of the same kind of page", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const record = (id: number, title: string) => ({ output: { id, title } });
    const { sources, failures } = agentWorkSources([
      call("a", "get-note", { id: 1 }, failed),
      call("b", "get-doc", { id: 1 }, record(1, "Apollo")),
      call("c", "get-note", { id: 2 }, failed),
      call("d", "read-notes", { noteId: 2 }, record(2, "Ann")),
      call("e", "get-document", { id: 3 }, failed),
      call(
        "f",
        "view-screen",
        {},
        { output: { document: { id: 3, title: "Spec" } } },
      ),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Apollo", "Ann", "Spec"]);
    expect(failures.map(({ label }) => label)).toEqual(["get-note"]);
  });

  it("clears a failed page read with any read of that page from the same source", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const { sources, failures } = agentWorkSources([
      call("a", "get-document", { id: "p" }, failed),
      call("b", "get-document", { id: "q" }, failed),
      call("c", "mcp__notion__get_page", { id: "p" }, failed),
      call(
        "d",
        "read-page",
        { id: "p" },
        { output: { id: "p", title: "Plan" } },
      ),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Plan"]);
    expect(failures.map(({ label }) => label)).toEqual([
      "get-document",
      "mcp__notion__get_page",
    ]);
  });

  it("keeps a failed search for each scope until that scope succeeds", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const slack = "mcp__slack__search_messages";
    const attempts = [
      call("a", "search-documents", { id: "x", query: "alpha" }, failed),
      call("b", "search-documents", { id: "x", query: "beta" }),
      call("c", slack, { channel: "eng", text: "launch" }, failed),
      call("d", slack, { channel: "ops", text: "launch" }, failed),
      call("e", slack, { channel: "eng", text: "launch" }),
    ];
    const first = agentWorkSources(attempts);
    expect(first.sources.map(({ text }) => text)).toEqual(["beta", "launch"]);
    expect(first.failures.map(({ label, text }) => [label, text])).toEqual([
      ["search-documents", "alpha"],
      [slack, "launch"],
    ]);
    const second = agentWorkSources([
      ...attempts,
      call("f", slack, { channel: "ops", text: "launch" }),
    ]);
    expect(second.failures.map(({ label }) => label)).toEqual([
      "search-documents",
    ]);
  });

  it("reads a page's numeric id the same as its text form", () => {
    const failed = { status: "failed" as const, output: "Timed out" };
    const page = (id: number | string, title: string) => ({
      output: { id, title },
    });
    const { sources, failures } = agentWorkSources([
      call("a", "get-page", { id: 4521 }, failed),
      call("b", "read-page", { documentId: 4521 }, page(4521, "Launch plan")),
      call("c", "get-page", { id: 7 }, page(7, "Roadmap")),
      call("d", "get-page", { id: "7" }, page("7", "Roadmap")),
    ]);
    expect(sources.map(({ text }) => text)).toEqual(["Launch plan", "Roadmap"]);
    expect(failures).toEqual([]);
  });

  it("counts a read as a page only when its tool names one", () => {
    const failed = { status: "failed" as const, output: "Denied" };
    const record = (name: string) => ({ output: { id: "1", name } });
    const { sources, failures } = agentWorkSources([
      call("a", "get-customer", { id: "1" }, record("Ann")),
      call("b", "get-sql-dashboard", { id: "1" }, record("Revenue")),
      call("c", "get-customer", { id: "2" }, failed),
      call(
        "d",
        "view-screen",
        {},
        { output: { document: { id: "p", title: "Plan" } } },
      ),
      call(
        "e",
        "mcp__notion__notion-fetch",
        { id: "n" },
        { output: { id: "n", title: "Roadmap" } },
      ),
      call("e2", "get", { id: "1" }, record("Ann")),
      call("e3", "fetch", { id: "2" }, failed),
      call(
        "f",
        "read-page",
        { id: "w" },
        { output: { id: "w", title: "Wiki" } },
      ),
      call(
        "g",
        "get-invoice",
        { id: "i" },
        { output: { document: { id: "x", name: "Receipt" } } },
      ),
      call(
        "h",
        "mcp__content__view-screen",
        {},
        { output: { document: { id: "s", title: "Spec" } } },
      ),
    ]);
    expect(sources.map(({ kind, text }) => [kind, text])).toEqual([
      ["document", "Plan"],
      ["document", "Wiki"],
      ["document", "Spec"],
    ]);
    expect(failures).toEqual([]);
  });

  it("keeps MCP servers outside the catalog apart by their server name", () => {
    const read = (id: string, server: string, title: string) =>
      call(
        id,
        `mcp__${server}__get_page`,
        { id: "same" },
        { output: { id: "same", title } },
      );
    const { sources } = agentWorkSources([
      read("a", "wiki", "Wiki page"),
      read("b", "tracker", "Tracker page"),
      read("c", "wiki", "Wiki page"),
    ]);
    expect(sources.map(({ text }) => text)).toEqual([
      "Wiki page",
      "Tracker page",
    ]);
  });

  it("clears a failure only with a read of the same address, or the same tool's id or search", () => {
    const failed = { status: "failed" as const, error: { message: "Denied" } };
    const { failures } = agentWorkSources([
      call("a", "get-document", { id: "abc" }, failed),
      call(
        "b",
        "list-comments",
        { documentId: "abc" },
        { activity: { kind: "read" } },
      ),
      call("c", "web-search", { query: "pricing" }, failed),
      call("d", "search-documents", { query: "pricing" }),
      call("e", "web-request", { url: "https://b.dev/y" }, failed),
      call("f", "read", { url: "https://b.dev/y" }),
      call("g", "read", { path: "/repo/a.md" }, failed),
      call("h", "grep", { path: "/repo/a.md" }, { activity: { kind: "read" } }),
    ]);
    expect(failures.map(({ label }) => label)).toEqual([
      "get-document",
      "web-search",
    ]);
  });
});

describe("agentWorkFailureReason", () => {
  it("reads a JSON output's error or message, and never shows raw JSON", () => {
    const reason = (output: string) =>
      agentWorkFailureReason(call("c", "x", {}, { status: "failed", output }));
    expect(reason('{"error":"Rate limited.","code":429}')).toBe("Rate limited");
    expect(reason('{"error":{"message":"Page not found."}}')).toBe(
      "Page not found",
    );
    expect(reason('{"message":"Denied"}')).toBe("Denied");
    expect(reason('{"ok":false,"code":"x"}')).toBe(undefined);
    expect(reason("[1, 2]")).toBe(undefined);
    expect(reason('Error running get-document: {"error":"Not found."}')).toBe(
      "Not found",
    );
    expect(reason('Error: {"message":"Denied"}')).toBe("Denied");
    expect(reason('Error running x: {"ok":false}')).toBe(undefined);
    const parsed = (output: unknown) =>
      agentWorkFailureReason(call("c", "x", {}, { status: "failed", output }));
    expect(parsed({ error: "Rate limited." })).toBe("Rate limited");
    expect(parsed({ error: { message: "Page not found." } })).toBe(
      "Page not found",
    );
    expect(parsed({ ok: false })).toBe(undefined);
  });

  it("keeps a plain error that only starts like JSON as the reason", () => {
    const reason = (overrides: Parameters<typeof call>[3]) =>
      agentWorkFailureReason(
        call("c", "x", {}, { status: "failed", ...overrides }),
      );
    const summary = (text: string) => ({
      activity: { summary: [{ type: "text" as const, text }] },
    });
    expect(reason({ output: "[Errno 2] No such file" })).toBe(
      "[Errno 2] No such file",
    );
    expect(reason({ output: "{Error: not found}" })).toBe("{Error: not found}");
    expect(reason(summary("[Errno 13] Permission denied"))).toBe(
      "[Errno 13] Permission denied",
    );
    expect(reason(summary('{"ok":false}'))).toBe(undefined);
    const detail = (text: string) => ({ activity: { detail: text } });
    expect(reason(detail('{"error":"Quota exceeded."}'))).toBe(
      "Quota exceeded",
    );
    expect(reason(detail('{"ok":false}'))).toBe(undefined);
    expect(reason(detail("[Errno 28] No space left"))).toBe(
      "[Errno 28] No space left",
    );
  });

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
          "get-document",
          {},
          {
            status: "failed",
            output: 'Error running get-document: Document "d2" not found',
          },
        ),
      ),
    ).toBe('Document "d2" not found');
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

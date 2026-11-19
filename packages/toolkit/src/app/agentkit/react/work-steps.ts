import {
  inferAgentActivityKind,
  type AgentActivity,
  type AgentEvent,
  type AgentMessage,
  type AgentMessagePart,
  type AgentToolCall,
} from "@agent-native/agentkit/protocol";

export interface AgentReasoningSection {
  heading?: string;
  body: string;
}

// A bold run opens a section when it starts the text or a line, or follows a
// finished sentence; summaries often arrive with their line breaks dropped.
const REASONING_HEADING = /(^|\n|[.!?:]["'”)]?[ \t]+)\*\*([^*\n]+?)\*\*/g;

/** Splits model reasoning into the sections its bold headings start. */
export function agentReasoningSections(text: string): AgentReasoningSection[] {
  const starts: { index: number; heading: string; bodyStart: number }[] = [];
  for (const match of text.matchAll(REASONING_HEADING)) {
    // Both groups always take part in a match.
    const lead = match.at(1);
    const heading = match.at(2);
    if (lead === undefined || heading === undefined) continue;
    starts.push({
      index: match.index + lead.length,
      heading: heading.trim(),
      bodyStart: match.index + match[0].length,
    });
  }
  const sections: AgentReasoningSection[] = [];
  const lead = text.slice(0, starts[0]?.index ?? text.length).trim();
  if (lead) sections.push({ body: lead });
  starts.forEach((start, index) => {
    sections.push({
      heading: start.heading,
      body: text
        .slice(start.bodyStart, starts[index + 1]?.index ?? text.length)
        .trim(),
    });
  });
  return sections;
}

type ReasoningPart = Extract<AgentMessagePart, { type: "reasoning" }>;

function isVisibleReasoning(part: AgentMessagePart): part is ReasoningPart {
  return (
    part.type === "reasoning" &&
    part.visibility !== "hidden" &&
    Boolean(part.text.trim())
  );
}

/** One run segment's work in the order it happened. */
export type AgentWorkTimelineEntry =
  | {
      type: "reasoning";
      key: string;
      messageId: string;
      text: string;
      active: boolean;
    }
  | { type: "call"; id: string };

export interface AgentWorkTimelineInput {
  events: readonly AgentEvent[];
  /** The call an event starts or updates, when it is one this segment shows. */
  callIdOf: (event: AgentEvent) => string | undefined;
  /** The reasoning message an event streamed or carried, at its latest state. */
  reasoningOf: (event: AgentEvent) => AgentMessage | undefined;
  /** Which first events belong to this segment; work before it only counts. */
  includes?: ((event: AgentEvent) => boolean) | undefined;
  /**
   * Saved reasoning whose stream events are gone. Each part lands before the
   * first call it names in `toolCallIds`, or with the part after it.
   */
  folded?: AgentMessage | undefined;
}

type TimelineToken =
  | { kind: "reasoning"; messageId: string; start: number; event: AgentEvent }
  | { kind: "call"; id: string; event: AgentEvent };

/**
 * Orders reasoning and calls for one segment. A reasoning message streamed
 * around tool calls splits at the calls, but only when its deltas rebuild the
 * saved text exactly; otherwise it stays whole where it first appeared.
 */
export function agentWorkTimeline({
  events,
  callIdOf,
  reasoningOf,
  includes,
  folded,
}: AgentWorkTimelineInput): AgentWorkTimelineEntry[] {
  const tokens: TimelineToken[] = [];
  const streamed = new Map<string, string>();
  const messages = new Map<string, AgentMessage>();
  const seenCalls = new Set<string>();
  for (const event of events) {
    if (event.type === "message.replaced") {
      // A discarded draft keeps only a prefix of what streamed, so chunks
      // past it are gone and later deltas resume at its end.
      const id = event.message.id;
      const kept = event.message.parts
        .filter(isVisibleReasoning)
        .map((part) => part.text)
        .join("");
      const text = streamed.get(id);
      if (text?.startsWith(kept)) {
        streamed.set(id, kept);
        const dropped = tokens.filter(
          (token) =>
            token.kind === "reasoning" &&
            token.messageId === id &&
            token.start >= kept.length,
        );
        for (const token of dropped) tokens.splice(tokens.indexOf(token), 1);
      }
      continue;
    }
    const message = reasoningOf(event);
    if (message) {
      messages.set(message.id, message);
      const opened = tokens.some(
        (token) => token.kind === "reasoning" && token.messageId === message.id,
      );
      if (event.type === "reasoning.delta") {
        const last = tokens.at(-1);
        const text = streamed.get(message.id) ?? "";
        if (last?.kind !== "reasoning" || last.messageId !== message.id) {
          tokens.push({
            kind: "reasoning",
            messageId: message.id,
            start: text.length,
            event,
          });
        }
        streamed.set(message.id, text + event.text);
      } else if (!opened) {
        tokens.push({
          kind: "reasoning",
          messageId: message.id,
          start: 0,
          event,
        });
      }
      continue;
    }
    const callId = callIdOf(event);
    if (callId && !seenCalls.has(callId)) {
      seenCalls.add(callId);
      tokens.push({ kind: "call", id: callId, event });
    }
  }

  const ordered: TimelineEntry[] = [];
  const chunkEnds = new Map<TimelineToken, number>();
  const splittable = new Set<string>();
  for (const [messageId, message] of messages) {
    const full = message.parts
      .filter(isVisibleReasoning)
      .map((part) => part.text)
      .join("");
    if (streamed.get(messageId) === full) splittable.add(messageId);
  }
  for (const [index, token] of tokens.entries()) {
    if (token.kind !== "reasoning") continue;
    const next = tokens
      .slice(index + 1)
      .find(
        (candidate) =>
          candidate.kind === "reasoning" &&
          candidate.messageId === token.messageId,
      );
    if (next?.kind === "reasoning") chunkEnds.set(token, next.start);
  }
  const placed = new Set<string>();
  for (const token of tokens) {
    if (token.kind === "call") {
      ordered.push({ type: "call", id: token.id, event: token.event });
      continue;
    }
    const message = messages.get(token.messageId);
    if (!message) continue;
    const full = message.parts
      .filter(isVisibleReasoning)
      .map((part) => part.text)
      .join("");
    const split = splittable.has(token.messageId);
    if (!split && placed.has(token.messageId)) continue;
    placed.add(token.messageId);
    const end = split ? chunkEnds.get(token) : undefined;
    const text = split ? full.slice(token.start, end ?? full.length) : full;
    if (!text.trim()) continue;
    ordered.push({
      type: "reasoning",
      key: `reasoning:${message.id}:${split ? token.start : 0}`,
      messageId: message.id,
      text,
      active: message.status === "streaming" && (end === undefined || !split),
      event: token.event,
    });
  }

  // Reasoning its deltas cannot place, such as a saved reply that arrived
  // whole, lands by the calls each part names, as folded reasoning does.
  const anchored = [...messages.values()].filter(
    (message) =>
      !splittable.has(message.id) &&
      message.parts.some(
        (part) => isVisibleReasoning(part) && part.toolCallIds?.length,
      ),
  );
  let timeline: TimelineEntry[] = ordered.filter(
    (entry) => !includes || !entry.event || includes(entry.event),
  );
  for (const message of anchored) {
    const at = timeline.findIndex(
      (entry) => entry.type === "reasoning" && entry.messageId === message.id,
    );
    if (at < 0) continue;
    timeline = placeByCalls(
      timeline.filter((_, index) => index !== at),
      message,
      at,
    );
  }
  if (folded) timeline = placeByCalls(timeline, folded, timeline.length);
  return timeline.map(({ event: _event, ...entry }) => entry);
}

type TimelineEntry = AgentWorkTimelineEntry & { event?: AgentEvent };

/**
 * Inserts each visible reasoning part before the first call it names. A part
 * that names none sits with the part after it, and the last such part at
 * `fallback`, where the message itself appeared.
 */
function placeByCalls(
  timeline: TimelineEntry[],
  message: AgentMessage,
  fallback: number,
): TimelineEntry[] {
  const parts = message.parts.filter(isVisibleReasoning);
  if (!parts.length) return timeline;
  const callIndex = new Map<string, number>();
  timeline.forEach((entry, index) => {
    if (entry.type === "call") callIndex.set(entry.id, index);
  });
  // Parts that land before the timeline entry at each position, in order.
  const before = new Map<number, TimelineEntry[]>();
  let nextPosition = fallback;
  for (const [partIndex, part] of [...parts.entries()].reverse()) {
    const anchors = (part.toolCallIds ?? [])
      .map((id) => callIndex.get(id))
      .filter((position): position is number => position !== undefined);
    const position = anchors.length
      ? Math.min(...anchors, nextPosition)
      : nextPosition;
    before.set(position, [
      {
        type: "reasoning",
        key: `reasoning:${message.id}:part:${partIndex}`,
        messageId: message.id,
        text: part.text,
        active: false,
      },
      ...(before.get(position) ?? []),
    ]);
    nextPosition = position;
  }
  return [
    ...timeline.flatMap((entry, index) => [
      ...(before.get(index) ?? []),
      entry,
    ]),
    ...(before.get(timeline.length) ?? []),
  ];
}

/** How a step names a run of calls: what they did, not which tool did it. */
export type AgentWorkVerb =
  | "searched"
  | "readPages"
  | "readDocuments"
  | "fetched"
  | "readFiles"
  | "edited"
  | "ranCommands"
  | "ranActions"
  | "used";

export interface AgentWorkObject {
  /** `document` is a page in the app itself, named by the read's result. */
  kind: "query" | "url" | "file" | "command" | "document";
  text: string;
  /** What tells two objects with the same text apart: a page's id, a file's path. */
  id?: string;
  /** Where a document opens, when its read returned a link. */
  uri?: string;
}

export interface AgentWorkCall {
  id: string;
  activity: AgentActivity;
  tool?: AgentToolCall;
  /** The integration a call ran through; calls from different ones never merge. */
  sourceId?: string;
  /** A host renderer owns this call's row, so it never joins a group. */
  standalone?: boolean;
}

export interface AgentWorkGroup {
  key: string;
  verb: AgentWorkVerb;
  calls: [AgentWorkCall, ...AgentWorkCall[]];
  /** Distinct objects in call order: queries, page domains, file names. */
  objects: AgentWorkObject[];
  /** Calls that failed the same way; `reason` is the shared short reason. */
  failed: boolean;
  reason?: string;
  running: boolean;
  standalone: boolean;
}

export interface AgentWorkStep {
  key: string;
  /** The heading the agent wrote, or its first sentence; none before any reasoning. */
  title?: string | undefined;
  /** Reasoning markdown behind the title; empty when the title is all of it. */
  body: string;
  /** The section's reasoning as written, heading included, for host renderers. */
  reasoning?: string;
  active: boolean;
  groups: AgentWorkGroup[];
  /** The verb with the most calls, which names an untitled step. */
  dominantVerb?: AgentWorkVerb;
  callCount: number;
  failedCount: number;
  running: boolean;
}

export type AgentWorkItem =
  | {
      type: "reasoning";
      key: string;
      text: string;
      active: boolean;
      /** A label the agent gave this reasoning; it titles one whole step. */
      label?: string;
    }
  | { type: "call"; call: AgentWorkCall };

function inputRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim().startsWith("{")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    // coercion-ok: a tool input that is not JSON has no structured fields; the step names its call by tool name instead.
    return undefined;
  }
}

function firstString(
  input: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().replace(/\s+/g, " ");
    }
  }
  return undefined;
}

const QUERY_KEYS = ["query", "q", "search", "searchQuery", "pattern"] as const;
const URL_KEYS = ["url", "href", "uri", "link"] as const;
const FILE_KEYS = [
  "path",
  "filePath",
  "file_path",
  "filename",
  "file",
] as const;
const COMMAND_KEYS = ["command", "cmd", "script"] as const;

function urlDomain(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.hostname.replace(/^www\./, "") || undefined;
  } catch {
    // coercion-ok: a value that is not an absolute web address names no page, so the step shows no domain.
    return undefined;
  }
}

function fileName(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).at(-1) || trimmed;
}

function documentRecord(
  record: Record<string, unknown> | undefined,
): AgentWorkObject | undefined {
  const id = firstString(record, ["id", "documentId"]);
  const title = firstString(record, ["title", "name"]);
  if (!id || !title) return undefined;
  const uri = firstString(record, ["deepLink", "url"]);
  return { kind: "document", text: title, id, ...(uri ? { uri } : {}) };
}

const documentsByTool = new WeakMap<AgentToolCall, AgentWorkObject | null>();

function documentObject(call: AgentWorkCall): AgentWorkObject | undefined {
  const tool = call.tool;
  if (!tool || readKind(call) !== "read") return undefined;
  if (call.activity.status === "failed" || tool.error) return undefined;
  if (
    firstString(inputRecord(tool.input), FILE_KEYS) ||
    call.activity.object?.kind === "file"
  ) {
    return undefined;
  }
  const cached = documentsByTool.get(tool);
  if (cached !== undefined) return cached ?? undefined;
  const output = inputRecord(tool.output);
  const document =
    documentRecord(output) ?? documentRecord(inputRecord(output?.document));
  documentsByTool.set(tool, document ?? null);
  return document;
}

function sendsWriteMethod(input: Record<string, unknown> | undefined): boolean {
  const method = firstString(input, ["method"])?.toUpperCase();
  return Boolean(method && method !== "GET" && method !== "HEAD");
}

/** The object a call acted on, read from its input or activity reference. */
export function agentWorkCallObject(
  call: AgentWorkCall,
): AgentWorkObject | undefined {
  const input = inputRecord(call.tool?.input);
  const query = firstString(input, QUERY_KEYS);
  if (query) return { kind: "query", text: query };
  const document = documentObject(call);
  if (document) return document;
  const url = firstString(input, URL_KEYS) ?? call.activity.object?.uri;
  const domain = url ? urlDomain(url) : undefined;
  if (url && domain) return { kind: "url", text: domain, uri: url };
  const file =
    firstString(input, FILE_KEYS) ??
    (call.activity.object?.kind === "file"
      ? call.activity.object.label
      : undefined);
  if (file) return { kind: "file", text: fileName(file), id: file };
  const command = firstString(input, COMMAND_KEYS);
  if (command) return { kind: "command", text: command };
  return undefined;
}

/**
 * What a tool call did, from its activity kind and the object it acted on.
 * An activity without a tool keeps the label its producer wrote.
 */
export function agentWorkCallVerb(call: AgentWorkCall): AgentWorkVerb {
  if (!call.tool) return "used";
  const kind = call.activity.kind;
  const object = agentWorkCallObject(call);
  if (kind === "search" || object?.kind === "query") return "searched";
  if (object?.kind === "url") {
    const input = inputRecord(call.tool.input);
    const mode = firstString(input, ["responseMode", "format"])?.toLowerCase();
    return sendsWriteMethod(input) || mode === "json" ? "fetched" : "readPages";
  }
  if (object?.kind === "document") return "readDocuments";
  if (object?.kind === "file") {
    return kind === "edit" || kind === "write" ? "edited" : "readFiles";
  }
  if (kind === "command" || object?.kind === "command") return "ranCommands";
  if (kind === "write" || kind === "edit") return "ranActions";
  return "used";
}

const FAILURE_REASON_LIMIT = 160;

/** A failed call's reason on one line: its HTTP status, or its first sentence. */
export function agentWorkFailureReason(
  call: AgentWorkCall,
): string | undefined {
  const tool = call.tool;
  const summary = call.activity.summary?.find(
    (part): part is Extract<AgentMessagePart, { type: "text" }> =>
      part.type === "text" && Boolean(part.text.trim()),
  )?.text;
  const source =
    tool?.error?.message.trim() ||
    (typeof tool?.output === "string" ? tool.output.trim() : undefined) ||
    (summary && !/^\s*[[{]/.test(summary) ? summary.trim() : undefined) ||
    call.activity.detail?.trim();
  if (!source) return undefined;
  const status = /\bHTTP\s+\d{3}\b[^\n]*/i.exec(source)?.[0];
  const line =
    status ?? source.split("\n").find((candidate) => candidate.trim()) ?? "";
  const sentence = (status ? line : (line.split(/(?<=[.!?])\s/)[0] ?? line))
    .replace(/^error running \S+?:\s+/i, "")
    .replace(/^error:\s*/i, "")
    .replace(/[.:;,]\s*$/, "")
    .replace(/\s*\((?:error)?code:[^)]*\)\s*$/i, "")
    .trim();
  if (!sentence) return undefined;
  return sentence.length > FAILURE_REASON_LIMIT
    ? `${sentence.slice(0, FAILURE_REASON_LIMIT).trimEnd()}…`
    : sentence;
}

function callIdentity(call: AgentWorkCall, verb: AgentWorkVerb): string {
  const tool =
    verb === "used"
      ? (call.tool?.name ??
        `${call.activity.kind}\u0002${call.activity.label.trim()}`)
      : "";
  return [verb, tool, call.activity.agentId ?? "", call.sourceId ?? ""].join(
    "\u0001",
  );
}

const TITLE_LIMIT = 120;

/** Reasoning text as a one-line plain title, without markdown syntax. */
function plainTitle(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function firstSentence(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length > TITLE_LIMIT
    ? `${sentence.slice(0, TITLE_LIMIT).trimEnd()}…`
    : sentence;
}

function newStep(
  key: string,
  section?: AgentReasoningSection,
  active = false,
): AgentWorkStep {
  let title: string | undefined;
  let body = "";
  if (section?.heading) {
    title = plainTitle(section.heading) || section.heading;
    body = section.body;
  } else if (section) {
    const plain = plainTitle(section.body);
    title = firstSentence(plain);
    body = plain === title ? "" : section.body;
  }
  return {
    key,
    title,
    body,
    ...(section
      ? {
          reasoning: section.heading
            ? `**${section.heading}**\n\n${section.body}`.trim()
            : section.body,
        }
      : {}),
    active,
    groups: [],
    callCount: 0,
    failedCount: 0,
    running: active,
  };
}

/**
 * Narrated steps for one segment: each reasoning heading opens a step, and
 * the calls after it, until the next reasoning, join that step grouped by
 * what they did. Calls before any reasoning open one untitled step. Failed
 * calls group apart by their short reason, so the failure lines add up to the
 * segment's failed count.
 */
export function agentWorkSteps(
  items: readonly AgentWorkItem[],
): AgentWorkStep[] {
  const steps: AgentWorkStep[] = [];
  const groupsByStep = new Map<AgentWorkStep, Map<string, AgentWorkGroup>>();
  for (const item of items) {
    if (item.type === "reasoning") {
      const sections = item.label?.trim()
        ? [{ heading: item.label.trim(), body: item.text.trim() }]
        : agentReasoningSections(item.text);
      sections.forEach((section, index) => {
        steps.push(
          newStep(
            `${item.key}:${index}`,
            section,
            item.active && index === sections.length - 1,
          ),
        );
      });
      continue;
    }
    let step = steps.at(-1);
    if (!step) {
      step = newStep("lead");
      steps.push(step);
    }
    const { call } = item;
    const verb = agentWorkCallVerb(call);
    const failed = call.activity.status === "failed";
    const reason = failed ? agentWorkFailureReason(call) : undefined;
    const identity = call.standalone
      ? `standalone\u0001${call.id}`
      : `${failed ? `failed\u0001${reason ?? ""}\u0001` : ""}${callIdentity(call, verb)}`;
    let groups = groupsByStep.get(step);
    if (!groups) {
      groups = new Map();
      groupsByStep.set(step, groups);
    }
    let group = groups.get(identity);
    if (group) {
      group.calls.push(call);
    } else {
      group = {
        key: `${step.key}:${call.id}`,
        verb,
        calls: [call],
        objects: [],
        failed,
        ...(reason ? { reason } : {}),
        running: false,
        standalone: Boolean(call.standalone),
      };
      groups.set(identity, group);
      step.groups.push(group);
    }
    const object = agentWorkCallObject(call);
    if (
      object &&
      !group.objects.some(
        (existing) =>
          existing.kind === object.kind && existing.text === object.text,
      )
    ) {
      group.objects.push(object);
    }
    const running = call.activity.status === "running";
    group.running ||= running;
    step.running ||= running;
    step.callCount += 1;
    if (failed) step.failedCount += 1;
  }
  for (const step of steps) {
    const counts = new Map<AgentWorkVerb, number>();
    for (const group of step.groups) {
      counts.set(
        group.verb,
        (counts.get(group.verb) ?? 0) + group.calls.length,
      );
    }
    let dominant: AgentWorkVerb | undefined;
    let dominantCount = 0;
    for (const [verb, count] of counts) {
      if (dominant === undefined || count > dominantCount) {
        dominant = verb;
        dominantCount = count;
      }
    }
    if (dominant) step.dominantVerb = dominant;
  }
  return steps;
}

/** What a reply drew on: a page in the app, a web page, a file or a search. */
export type AgentWorkSourceKind = "document" | "web" | "file" | "search";

export interface AgentWorkSource {
  key: string;
  kind: AgentWorkSourceKind;
  /** A page's title, a web page's domain, a file's name or a query. */
  text: string;
  uri?: string;
}

export interface AgentWorkSourceFailure {
  key: string;
  /** What it tried to use. */
  kind: AgentWorkSourceKind;
  /** The object, when the call named one; a failed page read names none. */
  text?: string;
  /** The activity's own label, for a failure that names no object. */
  label: string;
  reason?: string;
}

export interface AgentWorkSources {
  sources: AgentWorkSource[];
  failures: AgentWorkSourceFailure[];
}

const SOURCE_KINDS: Partial<Record<AgentWorkVerb, AgentWorkSourceKind>> = {
  readDocuments: "document",
  readPages: "web",
  fetched: "web",
  readFiles: "file",
  searched: "search",
};

const OBJECT_SOURCE_KINDS: Partial<
  Record<AgentWorkObject["kind"], AgentWorkSourceKind>
> = {
  document: "document",
  url: "web",
  file: "file",
  query: "search",
};

function sourceKind(
  call: AgentWorkCall,
  object: AgentWorkObject | undefined,
): AgentWorkSourceKind | undefined {
  if (call.tool) return SOURCE_KINDS[agentWorkCallVerb(call)];
  return object ? OBJECT_SOURCE_KINDS[object.kind] : undefined;
}

const SOURCE_ACTIVITY_KINDS = new Set<string>(["read", "search"]);
const WEB_READ_TOOLS = new Set(["web-request"]);
const WRITE_VERBS = new Set([
  "add",
  "apply",
  "archive",
  "assign",
  "clear",
  "create",
  "delete",
  "edit",
  "import",
  "insert",
  "invite",
  "mark",
  "move",
  "patch",
  "post",
  "publish",
  "remove",
  "rename",
  "replace",
  "reply",
  "reset",
  "restore",
  "save",
  "send",
  "set",
  "share",
  "submit",
  "sync",
  "toggle",
  "trash",
  "update",
  "upload",
  "write",
]);

const MCP_TOOL = /^mcp__.+?__(.+)$/i;

function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function startsWithWriteVerb(name: string): boolean {
  const verb = nameTokens(name)[0];
  return verb !== undefined && WRITE_VERBS.has(verb);
}

function readKind(call: AgentWorkCall): string {
  const mcpTool = MCP_TOOL.exec(call.tool?.name ?? "")?.[1];
  if (mcpTool === undefined) return call.activity.kind;
  if (nameTokens(mcpTool).some((token) => WRITE_VERBS.has(token))) {
    return "write";
  }
  return inferAgentActivityKind(mcpTool);
}

function readsSources(call: AgentWorkCall): boolean {
  if (sendsWriteMethod(inputRecord(call.tool?.input))) return false;
  if (startsWithWriteVerb(call.tool?.name ?? "")) return false;
  return (
    SOURCE_ACTIVITY_KINDS.has(readKind(call)) ||
    WEB_READ_TOOLS.has(call.tool?.name ?? "")
  );
}

function sourceScope(call: AgentWorkCall): string {
  if (call.sourceId) return call.sourceId;
  const server = /^mcp__(.+?)__/i.exec(call.tool?.name ?? "")?.[1];
  return server ? `mcp:${server.toLowerCase()}` : "";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "";
}

function sourceKey(
  call: AgentWorkCall,
  kind: AgentWorkSourceKind,
  identity: string,
): string {
  return [sourceScope(call), kind, identity].join("\u0001");
}

function attemptTargets(
  call: AgentWorkCall,
  object: AgentWorkObject | undefined,
): string[] {
  const input = inputRecord(call.tool?.input);
  const tool = call.tool?.name ?? "";
  const page =
    object?.kind === "document"
      ? object.id
      : call.activity.status === "failed" && readKind(call) === "read"
        ? firstString(input, ["id", "documentId"])
        : undefined;
  const targets: [string, string, string | undefined][] = [
    ["page", "", page],
    object?.kind === "file"
      ? ["path", "", object.id]
      : ["id", tool, object?.id],
    ["uri", "", object?.uri],
    ["uri", "", firstString(input, URL_KEYS)],
    ["id", tool, firstString(input, ["id", "documentId"])],
    ["path", "", firstString(input, FILE_KEYS)],
    ["query", tool, firstString(input, QUERY_KEYS)],
    ["input", tool, call.tool ? stableJson(input ?? {}) : undefined],
  ];
  return targets.flatMap(([type, scope, target]) =>
    target ? [[sourceScope(call), type, scope, target].join("\u0001")] : [],
  );
}

/**
 * The sources a segment's calls read or searched, each once in call order,
 * and the reads and searches that failed and never succeeded later, each once
 * per object and reason. Only reads, searches and plain web requests count.
 */
export function agentWorkSources(
  calls: readonly AgentWorkCall[],
): AgentWorkSources {
  const sources = new Map<string, AgentWorkSource>();
  const failures = new Map<
    string,
    { failure: AgentWorkSourceFailure; targets: string[] }
  >();
  for (const call of calls) {
    const status = call.activity.status;
    if (status === "running" || status === "cancelled") continue;
    if (!readsSources(call)) continue;
    const object = agentWorkCallObject(call);
    if (status === "failed") {
      const kind =
        sourceKind(call, object) ??
        (readKind(call) === "search"
          ? "search"
          : readKind(call) === "read"
            ? "document"
            : undefined);
      if (!kind) continue;
      const named = object?.kind === "command" ? undefined : object;
      const text = named?.text;
      const reason = agentWorkFailureReason(call);
      const identity =
        named?.id ??
        named?.uri ??
        text ??
        firstString(inputRecord(call.tool?.input), ["id", "documentId"]);
      const key = [
        "failed",
        sourceKey(call, kind, identity ?? call.activity.label),
        reason ?? "",
      ].join("\u0001");
      if (failures.has(key)) continue;
      failures.set(key, {
        targets: attemptTargets(call, named),
        failure: {
          key,
          kind,
          ...(text ? { text } : {}),
          label: call.activity.label,
          ...(reason ? { reason } : {}),
        },
      });
      continue;
    }
    const read = new Set(attemptTargets(call, object));
    for (const [key, { targets }] of failures) {
      if (targets.some((target) => read.has(target))) failures.delete(key);
    }
    const kind = sourceKind(call, object);
    if (!kind || !object) continue;
    const key = sourceKey(call, kind, object.id ?? object.uri ?? object.text);
    const existing = sources.get(key);
    if (existing) {
      if (!existing.uri && object.uri) existing.uri = object.uri;
      continue;
    }
    sources.set(key, {
      key,
      kind,
      text: object.text,
      ...(object.uri ? { uri: object.uri } : {}),
    });
  }
  return {
    sources: [...sources.values()],
    failures: [...failures.values()].map(({ failure }) => failure),
  };
}

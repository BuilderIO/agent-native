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

const ID_KEYS = ["id", "documentId"] as const;

function firstId(
  record: Record<string, unknown> | undefined,
): string | undefined {
  for (const key of ID_KEYS) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
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
const SEARCH_TERM_KEYS = [
  "jql",
  "cql",
  "sql",
  "searchTerm",
  "search_term",
  "search_query",
  "keywords",
  "keyword",
  "terms",
  "term",
  "text",
] as const;

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
  const id = firstId(record);
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
  const pages = namesPages(call);
  const document =
    (pages ? documentRecord(output) : undefined) ??
    (pages || SCREEN_TOOLS.has(toolWords(call).join("-"))
      ? documentRecord(inputRecord(output?.document))
      : undefined);
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
  const reference = call.tool ? undefined : call.activity.object;
  const label = reference?.label.trim().replace(/\s+/g, " ");
  if (label && reference?.kind === "document") {
    const { id, uri } = reference;
    return { kind: "document", text: label, id, ...(uri ? { uri } : {}) };
  }
  if (label && reference?.kind === "query") {
    return { kind: "query", text: label };
  }
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
  if (readKind(call) !== "search") return undefined;
  const terms = firstString(input, SEARCH_TERM_KEYS);
  return terms ? { kind: "query", text: terms } : undefined;
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

function jsonText(text: string): boolean {
  if (!/^\s*[[{]/.test(text)) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    // coercion-ok: text that only starts like JSON, such as `[Errno 2] No such file`, is a plain message and stays the reason.
    return false;
  }
}

/** A failed call's reason on one line: its HTTP status, or its first sentence. */
const ERROR_PREFIX = /^(?:error running \S+?:\s+)?(?:error:\s*)?/i;

function outputReason(output: unknown): string | undefined {
  const text =
    typeof output === "string"
      ? output.trim().replace(ERROR_PREFIX, "")
      : undefined;
  if (text !== undefined && !jsonText(text)) return text || undefined;
  const record = inputRecord(text ?? output);
  return (
    firstString(record, ["error", "message"]) ??
    firstString(inputRecord(record?.error), ["message"])
  );
}

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
    outputReason(tool?.output) ||
    outputReason(summary) ||
    outputReason(call.activity.detail);
  if (!source) return undefined;
  const status = /\bHTTP\s+\d{3}\b[^\n]*/i.exec(source)?.[0];
  const line =
    status ?? source.split("\n").find((candidate) => candidate.trim()) ?? "";
  const sentence = (status ? line : (line.split(/(?<=[.!?])\s/)[0] ?? line))
    .replace(ERROR_PREFIX, "")
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
const SCREEN_TOOLS = new Set(["view-screen"]);
const FRAMEWORK_TOOLS = new Set([
  "tool-search",
  "search-actions",
  "get-script-run",
]);
const WRITE_VERBS = new Set([
  "accept",
  "add",
  "apply",
  "approve",
  "archive",
  "assign",
  "attach",
  "bookmark",
  "cancel",
  "clear",
  "close",
  "complete",
  "connect",
  "copy",
  "create",
  "decline",
  "delete",
  "detach",
  "disable",
  "disconnect",
  "dispatch",
  "duplicate",
  "edit",
  "emit",
  "enable",
  "enqueue",
  "favorite",
  "follow",
  "grant",
  "hide",
  "import",
  "insert",
  "install",
  "invite",
  "launch",
  "like",
  "lock",
  "mark",
  "merge",
  "move",
  "mute",
  "notify",
  "patch",
  "pin",
  "post",
  "publish",
  "react",
  "register",
  "reject",
  "remove",
  "rename",
  "replace",
  "reply",
  "reset",
  "restore",
  "revoke",
  "save",
  "send",
  "set",
  "share",
  "snooze",
  "star",
  "start",
  "stop",
  "submit",
  "subscribe",
  "sync",
  "toggle",
  "track",
  "trash",
  "trigger",
  "unbookmark",
  "unfavorite",
  "unhide",
  "uninstall",
  "unlock",
  "unpin",
  "unstar",
  "unsubscribe",
  "update",
  "upload",
  "vote",
  "write",
]);

function mcpToolParts(name: string): [string, string] | undefined {
  if (!name.toLowerCase().startsWith("mcp__")) return undefined;
  const rest = name.slice("mcp__".length);
  const split = rest.indexOf("__");
  const tool = rest.slice(split + 2);
  return split > 0 && tool ? [rest.slice(0, split), tool] : undefined;
}

function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const JOINERS = new Set(["and", "or", "then"]);

const RECORD_VERBS = new Set([
  "archive",
  "bookmark",
  "copy",
  "favorite",
  "import",
  "install",
  "invite",
  "like",
  "lock",
  "merge",
  "patch",
  "pin",
  "post",
  "reply",
  "share",
  "star",
  "track",
  "trigger",
  "upload",
  "vote",
]);

function writesBy(tokens: readonly string[]): boolean {
  const first = tokens.at(0) ?? "";
  const last = tokens.at(-1) ?? "";
  return (
    tokens.some(
      (token, index) =>
        WRITE_VERBS.has(token) &&
        (index === 0 || JOINERS.has(tokens.at(index - 1) ?? "")),
    ) ||
    (tokens.length > 1 &&
      WRITE_VERBS.has(last) &&
      !RECORD_VERBS.has(last) &&
      (READ_VERBS.has(first) ||
        SOURCE_ACTIVITY_KINDS.has(inferAgentActivityKind(first))))
  );
}

const READ_VERBS = new Set(["describe", "retrieve"]);
const REPLACEMENT_KEYS = [
  "replace",
  "replacement",
  "replaceWith",
  "replace_with",
  "newText",
  "new_text",
  "newString",
  "new_string",
] as const;

function replacesText(input: Record<string, unknown> | undefined): boolean {
  return input !== undefined && REPLACEMENT_KEYS.some((key) => key in input);
}

function toolWords(call: AgentWorkCall): string[] {
  const name = call.tool?.name ?? "";
  const parts = mcpToolParts(name);
  if (!parts) return nameTokens(name);
  const [serverName, toolName] = parts;
  const server = new Set(nameTokens(serverName));
  const named = nameTokens(toolName);
  const skip = named.findIndex(
    (token) =>
      !server.has(token) ||
      READ_VERBS.has(token) ||
      WRITE_VERBS.has(token) ||
      SOURCE_ACTIVITY_KINDS.has(inferAgentActivityKind(token)),
  );
  return skip === -1 ? named.slice(-1) : named.slice(skip);
}

const PAGE_WORDS = new Map([
  ["article", "article"],
  ["articles", "article"],
  ["doc", "page"],
  ["docs", "page"],
  ["document", "page"],
  ["documents", "page"],
  ["note", "note"],
  ["notes", "note"],
  ["page", "page"],
  ["pages", "page"],
]);

function pageNoun(call: AgentWorkCall): string | undefined {
  const words = toolWords(call);
  const word = words.slice(1).find((candidate) => PAGE_WORDS.has(candidate));
  if (word) return PAGE_WORDS.get(word);
  return SCREEN_TOOLS.has(words.join("-")) ? "page" : undefined;
}

function namesPages(call: AgentWorkCall): boolean {
  return toolWords(call)
    .slice(1)
    .some((word) => PAGE_WORDS.has(word));
}

function readKind(call: AgentWorkCall): string {
  const tokens = toolWords(call);
  if (!mcpToolParts(call.tool?.name ?? "")) {
    const first = tokens.at(0) ?? "";
    const kind =
      call.activity.kind === "tool" && READ_VERBS.has(first)
        ? "read"
        : call.activity.kind;
    const leads =
      READ_VERBS.has(first) ||
      SOURCE_ACTIVITY_KINDS.has(inferAgentActivityKind(first));
    return SOURCE_ACTIVITY_KINDS.has(kind) &&
      !leads &&
      tokens.some((token) => WRITE_VERBS.has(token))
      ? "write"
      : kind;
  }
  const verb = tokens.at(0);
  if (verb === undefined) return call.activity.kind;
  if (writesBy(tokens)) return "write";
  const verbKind = READ_VERBS.has(verb) ? "read" : inferAgentActivityKind(verb);
  if (SOURCE_ACTIVITY_KINDS.has(verbKind)) return verbKind;
  if (tokens.some((token) => WRITE_VERBS.has(token))) return "write";
  return inferAgentActivityKind(tokens.join("-"));
}

function readsSources(call: AgentWorkCall): boolean {
  const input = inputRecord(call.tool?.input);
  const sends = sendsWriteMethod(input) && firstString(input, URL_KEYS);
  if (sends || replacesText(input)) return false;
  const words = toolWords(call);
  if (writesBy(words) || FRAMEWORK_TOOLS.has(words.join("-"))) return false;
  return (
    SOURCE_ACTIVITY_KINDS.has(readKind(call)) ||
    WEB_READ_TOOLS.has(call.tool?.name ?? "")
  );
}

function sourceScope(call: AgentWorkCall): string {
  if (call.sourceId) return call.sourceId;
  const server = mcpToolParts(call.tool?.name ?? "")?.[0];
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
  return value === undefined ? "" : JSON.stringify(value);
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
  const whole = call.tool ? stableJson(input ?? {}) : undefined;
  const lookup = readKind(call) === "read" && namesPages(call);
  const failed = call.activity.status === "failed";
  const page =
    object?.kind === "document"
      ? object.id
      : lookup
        ? firstId(input)
        : undefined;
  const title =
    object?.kind === "document" && !failed
      ? object.text
      : lookup && !page
        ? firstString(input, ["title", "name"])
        : undefined;
  const searched =
    object?.kind === "query" ||
    (object === undefined && readKind(call) === "search");
  const targets: [string, string, string | undefined][] = searched
    ? [["input", tool, whole]]
    : [
        ["page", pageNoun(call) ?? "", page],
        ["page", "", call.tool && !failed ? page : undefined],
        ["title", pageNoun(call) ?? "", title?.toLowerCase()],
        object?.kind === "file"
          ? ["path", "", object.id]
          : ["id", tool, object?.id],
        ["uri", "", object?.uri],
        ["uri", "", firstString(input, URL_KEYS)],
        ["id", tool, firstId(input)],
        ["path", "", firstString(input, FILE_KEYS)],
        ["input", tool, whole],
      ];
  const found = targets.flatMap(([type, scope, target]) =>
    target ? [[sourceScope(call), type, scope, target].join("\u0001")] : [],
  );
  if (found.length || call.tool) return found;
  const { kind, label } = call.activity;
  return [[sourceScope(call), "activity", kind, label].join("\u0001")];
}

/**
 * The sources a segment's calls read or searched, each once in call order,
 * and the reads and searches that failed and never succeeded later, each once
 * per object and reason. Only reads, searches and plain web requests count.
 * Successes among `later`, the run's calls after this segment, clear this
 * segment's failures but add no sources.
 */
export function agentWorkSources(
  calls: readonly AgentWorkCall[],
  later: readonly AgentWorkCall[] = [],
): AgentWorkSources {
  const sources = new Map<string, AgentWorkSource>();
  const failures = new Map<
    string,
    { failure: AgentWorkSourceFailure; attempts: string[][] }
  >();
  for (const [index, call] of [...calls, ...later].entries()) {
    const status = call.activity.status;
    if (status === "running" || status === "cancelled") continue;
    if (!readsSources(call)) continue;
    const inSegment = index < calls.length;
    const object = agentWorkCallObject(call);
    if (status === "failed") {
      if (!inSegment) continue;
      const kind =
        sourceKind(call, object) ??
        (readKind(call) === "search"
          ? "search"
          : readKind(call) === "read" && namesPages(call)
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
        firstId(inputRecord(call.tool?.input)) ??
        (kind === "document"
          ? firstString(inputRecord(call.tool?.input), [
              "title",
              "name",
            ])?.toLowerCase()
          : undefined) ??
        (call.tool
          ? stableJson(inputRecord(call.tool.input) ?? {})
          : undefined);
      const key = [
        "failed",
        kind === "document" ? (pageNoun(call) ?? "") : (call.tool?.name ?? ""),
        sourceKey(call, kind, identity ?? call.activity.label),
        reason ?? "",
      ].join("\u0001");
      const targets = attemptTargets(call, named);
      const recorded = failures.get(key);
      if (recorded) {
        recorded.attempts.push(targets);
        continue;
      }
      failures.set(key, {
        attempts: [targets],
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
    for (const [key, recorded] of failures) {
      recorded.attempts = recorded.attempts.filter(
        (targets) => !targets.some((target) => read.has(target)),
      );
      if (!recorded.attempts.length) failures.delete(key);
    }
    const kind = sourceKind(call, object);
    if (!inSegment || !kind || !object) continue;
    const key = sourceKey(
      call,
      kind,
      object.kind === "document"
        ? [pageNoun(call) ?? "", object.id ?? "", object.text].join("\u0001")
        : (object.id ?? object.uri ?? object.text),
    );
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

import type {
  AgentActivity,
  AgentEvent,
  AgentMessage,
  AgentMessagePart,
  AgentToolCall,
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
  | "fetched"
  | "readFiles"
  | "edited"
  | "ranCommands"
  | "ranActions"
  | "used";

export interface AgentWorkObject {
  kind: "query" | "url" | "file" | "command";
  text: string;
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

/** The object a call acted on, read from its input or activity reference. */
export function agentWorkCallObject(
  call: AgentWorkCall,
): AgentWorkObject | undefined {
  const input = inputRecord(call.tool?.input);
  const query = firstString(input, QUERY_KEYS);
  if (query) return { kind: "query", text: query };
  const url = firstString(input, URL_KEYS) ?? call.activity.object?.uri;
  const domain = url ? urlDomain(url) : undefined;
  if (domain) return { kind: "url", text: domain };
  const file =
    firstString(input, FILE_KEYS) ??
    (call.activity.object?.kind === "file"
      ? call.activity.object.label
      : undefined);
  if (file) return { kind: "file", text: fileName(file) };
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
    const method = firstString(input, ["method"])?.toUpperCase();
    const mode = firstString(input, ["responseMode", "format"])?.toLowerCase();
    return (method && method !== "GET" && method !== "HEAD") || mode === "json"
      ? "fetched"
      : "readPages";
  }
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

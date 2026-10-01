/**
 * Pure helpers for the `[chat-reliability]` specs.
 *
 * Nothing here touches a browser, so every rule that decides "did the run
 * finish" can be unit-tested without spending a model turn. The browser half
 * lives in `chat-reliability.ts`.
 */

export const RELIABILITY_TAG = "[chat-reliability]";

/**
 * Apps that run the whole reliability set (8 turns each). Every other chat app
 * runs only the refresh-mid-run smoke (1 turn). Widening this list is a spend
 * decision, the same way `CHAT_APPS` in fleet.ts is.
 */
export const FULL_RELIABILITY_APPS: readonly string[] = ["chat", "analytics"];

/** Lines in the long streamed answer. Long enough to stream for many seconds. */
export const LONG_ANSWER_LINES = 40;

/**
 * The Stop test asks for more: luna streamed 40 lines in about 20 seconds, and
 * Stop cuts the run, so a longer answer widens the window without costing more.
 */
export const STOP_ANSWER_LINES = 100;

/** How long a working run may show no Stop control before that is the finding. */
export const NO_STOP_CONTROL_GRACE_MS = 3_000;

/**
 * Text that means a run ended in a state users have reported as "did not
 * finish". Matched case-insensitively against everything visible on the page.
 */
export const RUN_FAILURE_TEXT: readonly string[] = [
  "stream_ended",
  "The runtime stream ended",
  "The agent stopped before finishing",
  "Run already in progress",
  "ERROR ID",
  "Interrupted before this finished",
  "background_run_lost",
  "run_budget_exhausted",
  "The agent hit an error",
  "This chat looks stuck",
  "previous agent stream ended",
  "stopped without sending a final message",
];

export interface SerializablePattern {
  label: string;
  source: string;
  flags: string;
}

/**
 * Internal errors that must never reach a transcript or a toast: raw tool
 * failures, server error pages, and stack frames.
 */
export const INTERNAL_LEAK_PATTERNS: readonly SerializablePattern[] = [
  {
    label: "Action <name> failed:",
    source: "\\bAction [\\w.-]+ failed:",
    flags: "i",
  },
  {
    label: "Internal server error",
    source: "Internal server error",
    flags: "i",
  },
  { label: "<!DOCTYPE (raw HTML error page)", source: "<!DOCTYPE", flags: "i" },
  { label: "<html (raw HTML error page)", source: "<html[\\s>]", flags: "i" },
  {
    label: "stack trace frame",
    source: "^\\s*at\\s+.+:\\d+:\\d+\\)?\\s*$",
    flags: "m",
  },
  {
    label: "uncaught JS error name",
    source: "\\b(?:TypeError|ReferenceError|SyntaxError|RangeError):\\s",
    flags: "",
  },
];

export interface TextHit {
  kind: "run-failure" | "internal-leak";
  label: string;
  excerpt: string;
}

function excerptAround(text: string, index: number, length: number): string {
  return text
    .slice(Math.max(0, index - 80), index + length + 120)
    .replace(/\s+/g, " ")
    .trim();
}

/** Every forbidden string or pattern visible in `text`, one hit per label. */
export function scanVisibleText(text: string): TextHit[] {
  const hits: TextHit[] = [];
  const lower = text.toLowerCase();
  for (const needle of RUN_FAILURE_TEXT) {
    const index = lower.indexOf(needle.toLowerCase());
    if (index >= 0) {
      hits.push({
        kind: "run-failure",
        label: needle,
        excerpt: excerptAround(text, index, needle.length),
      });
    }
  }
  for (const pattern of INTERNAL_LEAK_PATTERNS) {
    const match = new RegExp(pattern.source, pattern.flags).exec(text);
    if (match) {
      hits.push({
        kind: "internal-leak",
        label: pattern.label,
        excerpt: excerptAround(text, match.index, match[0].length),
      });
    }
  }
  return hits;
}

export function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
}

export function lineToken(nonce: string, line: number): string {
  return `${nonce}-L${line}`;
}

/**
 * A prompt whose answer streams for several seconds. The expected tokens
 * (`NONCE-L1` ... `NONCE-L<lines>`) are built from the nonce, so the prompt
 * itself never contains the final token and the user's own bubble cannot stand
 * in for the assistant's answer. No slash, at-sign, or backtick: those open
 * composer popovers or markdown input rules.
 */
export function longAnswerPrompt(
  nonce: string,
  lines: number = LONG_ANSWER_LINES,
): string {
  return `Do not use any tools. Write exactly ${lines} lines. Line number k must start with ${nonce}-L followed by k, then a colon and one plain sentence of about twelve words about the number k. No preface and no closing remarks.`;
}

export function exactReplyPrompt(token: string): string {
  return `Reply with exactly ${token} and nothing else. Do not use any tools.`;
}

const THREAD_PATH = /\/chat\/([^/?#]+)/;

/** The thread id the page URL addresses: `?thread=`, `?threadId=`, or `/chat/<id>`. */
export function threadIdFromUrl(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const fromQuery =
    parsed.searchParams.get("thread") ?? parsed.searchParams.get("threadId");
  if (fromQuery?.trim()) return fromQuery.trim();
  const match = THREAD_PATH.exec(parsed.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

const THREAD_ROUTE = /\/_agent-native\/agent-chat\/threads\/([^/?#]+)/;

/** The thread id an agent-chat API request addresses, when it addresses one. */
export function threadIdFromRequestUrl(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const route = THREAD_ROUTE.exec(parsed.pathname);
  if (route) return decodeURIComponent(route[1]);
  if (parsed.pathname.endsWith("/_agent-native/agent-chat/runs/active")) {
    return parsed.searchParams.get("threadId")?.trim() || null;
  }
  return null;
}

/**
 * A URL that reopens `threadId` the way a user's bookmark would. Reuses the
 * current URL when it already addresses the thread (chat's `/chat/<id>`),
 * otherwise adds `?thread=` and keeps the sidebar open.
 */
export function threadDeepLink(
  origin: string,
  entryPath: string,
  threadId: string,
  currentUrl: string,
): string {
  if (threadIdFromUrl(currentUrl) === threadId) return currentUrl;
  const url = new URL(entryPath, origin);
  url.searchParams.set("thread", threadId);
  url.searchParams.set("agentSidebar", "open");
  return url.toString();
}

const PROMPT_PROBE_LENGTH = 40;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether the composer holds what was typed. The editor is rich text, so this
 * compares collapsed whitespace on the prompt's opening: enough to tell "typed"
 * from "swallowed by a re-mount".
 */
export function composerHoldsPrompt(
  composerText: string,
  prompt: string,
): boolean {
  return collapseWhitespace(composerText).includes(
    collapseWhitespace(prompt).slice(0, PROMPT_PROBE_LENGTH),
  );
}

export function tail(text: string, length: number): string {
  const trimmed = text.trim();
  return trimmed.length <= length ? trimmed : `...${trimmed.slice(-length)}`;
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  return text.split(needle).length - 1;
}

export interface ChatMessageView {
  role: string;
  id: string | null;
  busy: boolean;
  text: string;
}

export interface ChatState {
  url: string;
  composerFound: boolean;
  composerText: string;
  stopVisible: boolean;
  sendVisible: boolean;
  sendEnabled: boolean;
  /** Text of `[data-agentkit-current-activity]`, which only renders while a run is working. */
  currentActivity: string[];
  messages: ChatMessageView[];
  errorCards: { code: string | null; text: string }[];
  alerts: string[];
  bodyText: string;
}

export type StateRead =
  | { ok: true; state: ChatState }
  | { ok: false; reason: string };

/** Nothing in the UI says a run is still working. */
export function isIdle(state: ChatState): boolean {
  return (
    state.composerFound &&
    !state.stopVisible &&
    state.currentActivity.length === 0 &&
    !state.messages.some((message) => message.busy)
  );
}

export type StopControlState = "shown" | "finished" | "working-without-stop";

/**
 * What one read of the page says about pressing Stop on a streaming answer:
 * the control is there, the run is already over, or something says a run is
 * working yet the composer offers no way to stop it.
 */
export function stopControlState(state: ChatState): StopControlState {
  if (state.stopVisible) return "shown";
  return isIdle(state) ? "finished" : "working-without-stop";
}

export function describeState(state: ChatState): string {
  const messages = state.messages
    .map(
      (message) =>
        `${message.role}${message.busy ? "(busy)" : ""}[${message.text.length}ch]`,
    )
    .join(", ");
  return [
    `url=${state.url}`,
    `composer=${state.composerFound ? "found" : "MISSING"}`,
    `stop=${state.stopVisible ? "VISIBLE" : "hidden"}`,
    `send=${state.sendVisible ? (state.sendEnabled ? "enabled" : "disabled") : "hidden"}`,
    `activity=${JSON.stringify(state.currentActivity)}`,
    `messages=[${messages}]`,
    state.errorCards.length
      ? `errorCards=${JSON.stringify(state.errorCards)}`
      : "",
    state.alerts.length ? `alerts=${JSON.stringify(state.alerts)}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export interface ExpectedTurn {
  /** Appears in the user's own bubble, exactly once. */
  userToken: string;
  /** Appears in an assistant bubble after that user bubble. */
  answerToken: string;
  /** The model may legitimately narrate the token before the final answer. */
  allowRepeatedAnswer?: boolean;
}

/**
 * What is wrong with a transcript, as a list of problems. An empty list means
 * every expected turn has exactly one user bubble followed by an assistant
 * answer, in order, with nothing duplicated.
 */
export function checkTranscript(
  messages: readonly ChatMessageView[],
  turns: readonly ExpectedTurn[],
): string[] {
  const problems: string[] = [];
  let previousUser = -1;
  let previousAnswer = -1;
  for (const turn of turns) {
    const userIndexes = indexesOf(messages, "user", turn.userToken);
    if (userIndexes.length !== 1) {
      problems.push(
        userIndexes.length === 0
          ? `no user bubble contains ${turn.userToken}`
          : `${userIndexes.length} user bubbles contain ${turn.userToken} (duplicate)`,
      );
      continue;
    }
    const userIndex = userIndexes[0];
    if (userIndex < previousUser) {
      problems.push(`user bubble ${turn.userToken} is out of order`);
    }
    previousUser = Math.max(previousUser, userIndex);

    const answers = indexesOf(messages, "assistant", turn.answerToken);
    const answerIndex = answers.find((index) => index > userIndex);
    if (answerIndex === undefined) {
      problems.push(
        `no assistant bubble after the prompt ${turn.userToken} contains ${turn.answerToken}`,
      );
      continue;
    }
    if (answerIndex < previousAnswer) {
      problems.push(`assistant answer ${turn.answerToken} is out of order`);
    }
    previousAnswer = Math.max(previousAnswer, answerIndex);
    if (!turn.allowRepeatedAnswer && answers.length > 1) {
      problems.push(
        `${answers.length} assistant bubbles contain ${turn.answerToken} (duplicate answer)`,
      );
    }
  }
  return problems;
}

function indexesOf(
  messages: readonly ChatMessageView[],
  role: string,
  token: string,
): number[] {
  const found: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === role && message.text.includes(token))
      found.push(index);
  });
  return found;
}

/** Assistant bubbles that follow the user bubble containing `userToken`. */
export function assistantTextAfter(
  messages: readonly ChatMessageView[],
  userToken: string,
): string {
  const userIndex = indexesOf(messages, "user", userToken)[0];
  if (userIndex === undefined) return "";
  return messages
    .slice(userIndex + 1)
    .filter((message) => message.role === "assistant")
    .map((message) => message.text)
    .join("\n");
}

export interface TrafficEntry {
  atMs: number;
  method: string;
  path: string;
  query: string;
  status: number | null;
  failure?: string;
  /** From the request body of a turn POST. */
  threadId?: string;
}

/**
 * The thread the user's prompt went to: the latest turn POST's body, else the
 * thread the page most recently addressed in a request URL.
 */
export function threadIdFromTraffic(
  entries: readonly TrafficEntry[],
): string | null {
  const reversed = [...entries].reverse();
  const fromTurn = reversed.find((entry) => entry.threadId)?.threadId;
  if (fromTurn) return fromTurn;
  for (const entry of reversed) {
    const fromUrl = threadIdFromRequestUrl(
      `https://traffic.invalid${entry.path}${entry.query}`,
    );
    if (fromUrl) return fromUrl;
  }
  return null;
}

const TURN_PATH = "/_agent-native/agent-chat";

export function isTurnPost(entry: TrafficEntry): boolean {
  return (
    entry.method === "POST" &&
    entry.path.replace(/\/+$/, "").endsWith(TURN_PATH)
  );
}

function seconds(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

/**
 * One line per distinct call, with a count and first/last offset, so a poll
 * that ran forty times reads as one line. Anything that is not a plain 2xx is
 * listed individually so a 409 or a 5xx cannot hide in a group.
 */
export function summarizeTraffic(entries: readonly TrafficEntry[]): string {
  if (entries.length === 0) {
    return "  (no /_agent-native/agent-chat requests were observed)";
  }
  const groups = new Map<string, TrafficEntry[]>();
  const lines: string[] = [];
  for (const entry of entries) {
    const ok =
      entry.status !== null && entry.status >= 200 && entry.status < 300;
    if (!ok) {
      lines.push(
        `  ${seconds(entry.atMs)} ${entry.method} ${entry.path}${entry.query} -> ${entry.status ?? "no response"}${entry.failure ? ` (${entry.failure})` : ""}`,
      );
      continue;
    }
    const key = `${entry.method} ${entry.path} -> ${entry.status}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const [key, group] of groups) {
    const first = group[0];
    const last = group[group.length - 1];
    lines.push(
      group.length === 1
        ? `  ${seconds(first.atMs)} ${key}`
        : `  ${seconds(first.atMs)}..${seconds(last.atMs)} ${key} x${group.length}`,
    );
  }
  return lines.join("\n");
}

export interface PersistedMessage {
  role: string;
  status: string;
  text: string;
}

export type PersistedThread =
  | { kind: "unreadable"; reason: string }
  | {
      kind: "ok";
      title: string;
      preview: string;
      messageCount: number | null;
      messages: PersistedMessage[];
      /** Messages stored in a state that means "never finished". */
      unsettled: string[];
    };

const UNSETTLED_STATUSES = new Set([
  "streaming",
  "running",
  "in_progress",
  "incomplete",
  "error",
  "failed",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusName(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  return typeof record?.type === "string" ? record.type : "unknown";
}

function partsText(parts: unknown): string {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("\n");
}

/**
 * Reads the thread row the server returns for `GET /threads/<id>`. "Could not
 * read it" is its own result: a changed storage shape must not look like a
 * thread with no messages.
 */
export function inspectPersistedThread(body: unknown): PersistedThread {
  const record = asRecord(body);
  if (!record)
    return { kind: "unreadable", reason: "response is not an object" };
  let data: unknown = record.threadData;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (error) {
      return {
        kind: "unreadable",
        reason: `threadData is not JSON (${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }
  const dataRecord = asRecord(data);
  const agentKit = asRecord(dataRecord?.agentKit);
  const raw = Array.isArray(dataRecord?.messages)
    ? dataRecord.messages
    : Array.isArray(agentKit?.messages)
      ? agentKit.messages
      : null;
  if (!raw) {
    return { kind: "unreadable", reason: "threadData has no messages array" };
  }
  const messages: PersistedMessage[] = raw.map((item) => {
    const wrapper = asRecord(item);
    const message = asRecord(wrapper?.message) ?? wrapper;
    return {
      role: typeof message?.role === "string" ? message.role : "unknown",
      status: statusName(message?.status),
      text: partsText(message?.content ?? message?.parts),
    };
  });
  return {
    kind: "ok",
    title: typeof record.title === "string" ? record.title : "",
    preview: typeof record.preview === "string" ? record.preview : "",
    messageCount:
      typeof record.messageCount === "number" ? record.messageCount : null,
    messages,
    unsettled: messages
      .filter((message) => UNSETTLED_STATUSES.has(message.status))
      .map((message) => `${message.role}:${message.status}`),
  };
}

export function describePersisted(view: PersistedThread): string {
  if (view.kind === "unreadable") return `unreadable (${view.reason})`;
  return `title=${JSON.stringify(view.title)} messageCount=${view.messageCount} messages=[${view.messages.map((message) => `${message.role}:${message.status}[${message.text.length}ch]`).join(", ")}]${view.unsettled.length ? ` UNSETTLED=${view.unsettled.join(",")}` : ""}`;
}

export interface ActiveRunView {
  kind: "idle" | "active" | "unreadable";
  detail: string;
}

/** Reads `GET /runs/active?threadId=`: `active:false` is the server saying idle. */
export function inspectActiveRun(body: unknown): ActiveRunView {
  const record = asRecord(body);
  if (!record || typeof record.active !== "boolean") {
    return {
      kind: "unreadable",
      detail: `unexpected body ${JSON.stringify(body)?.slice(0, 200)}`,
    };
  }
  const detail = JSON.stringify({
    active: record.active,
    status: record.status,
    terminalReason: record.terminalReason ?? null,
    runId: record.runId ?? null,
  });
  return { kind: record.active ? "active" : "idle", detail };
}

export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

import {
  getHeader,
  getMethod,
  setResponseHeader,
  setResponseStatus,
  type H3Event,
} from "h3";

import type { AgentRunSummary } from "../../agent/run-store.js";
import { normalizeThreadRepository } from "../../agent/thread-data-builder.js";
import type { ChatThread } from "../../chat-threads/store.js";

// ---------------------------------------------------------------------------
// Read-only shared-thread route: renders a public HTML/JSON view of a chat
// thread reachable via its share token (see `handleSharedThreadRequest`).
// ---------------------------------------------------------------------------

function sanitizeSharedThread(thread: ChatThread): {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  scope: { type: string; label?: string } | null;
  messages: Array<{
    id?: string;
    role: "user" | "assistant" | "system";
    text: string;
    createdAt?: string | number;
  }>;
} {
  let repo: any = {};
  try {
    repo = normalizeThreadRepository(JSON.parse(thread.threadData));
  } catch {
    repo = {};
  }
  const messages = Array.isArray(repo.messages)
    ? repo.messages
        .map((entry: unknown) => sanitizeSharedMessage(entry))
        .filter(
          (
            entry: unknown,
          ): entry is NonNullable<ReturnType<typeof sanitizeSharedMessage>> =>
            entry != null,
        )
    : [];
  return {
    id: thread.id,
    title: thread.title,
    preview: thread.preview,
    messageCount: thread.messageCount,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    scope: thread.scope
      ? {
          type: thread.scope.type,
          ...(thread.scope.label ? { label: thread.scope.label } : {}),
        }
      : null,
    messages,
  };
}

type SanitizedSharedThread = ReturnType<typeof sanitizeSharedThread>;

export interface SharedThreadRouteDependencies {
  getThreadByShareToken: (token: string) => Promise<ChatThread | null>;
  listRunsForThread: (
    threadId: string,
    options?: { limit?: number },
  ) => Promise<AgentRunSummary[]>;
}

function escapeSharedThreadHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wantsSharedThreadHtml(event: H3Event): boolean {
  const accept = getHeader(event, "accept")?.toLowerCase() ?? "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function formatSharedThreadTime(value: string | number | null | undefined) {
  if (value == null) return "";
  const date =
    typeof value === "number"
      ? new Date(value)
      : Number.isFinite(Number(value))
        ? new Date(Number(value))
        : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function renderSharedThreadHtml(
  thread: SanitizedSharedThread,
  runs: AgentRunSummary[],
): string {
  const title = thread.title || "Shared agent session";
  const messages = thread.messages
    .map((message) => {
      const time = formatSharedThreadTime(message.createdAt);
      return `<article class="message ${escapeSharedThreadHtml(message.role)}">
        <div class="meta">
          <span>${escapeSharedThreadHtml(message.role)}</span>
          ${time ? `<time>${escapeSharedThreadHtml(time)}</time>` : ""}
        </div>
        <pre>${escapeSharedThreadHtml(message.text)}</pre>
      </article>`;
    })
    .join("");
  const runsHtml = runs.length
    ? `<section class="runs" aria-label="Recent runs">
        <h2>Recent runs</h2>
        <ol>${runs
          .map((run) => {
            const started = formatSharedThreadTime(run.startedAt);
            const completed = formatSharedThreadTime(run.completedAt);
            const detail = [
              started ? `started ${started}` : "",
              completed ? `completed ${completed}` : "",
              run.errorCode ? `error ${run.errorCode}` : "",
              run.abortReason ? `aborted ${run.abortReason}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return `<li><strong>${escapeSharedThreadHtml(run.status)}</strong>${detail ? `<span>${escapeSharedThreadHtml(detail)}</span>` : ""}</li>`;
          })
          .join("")}</ol>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="referrer" content="no-referrer" />
  <title>${escapeSharedThreadHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #1d1d1b; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(920px, calc(100vw - 32px)); margin: 0 auto; padding: 44px 0 64px; }
    header { border-bottom: 1px solid rgba(0,0,0,.12); padding-bottom: 24px; margin-bottom: 28px; }
    .eyebrow { margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #676760; }
    h1 { margin: 0; font-size: 42px; line-height: 1.08; letter-spacing: 0; }
    .summary { margin: 14px 0 0; color: #5c5c55; line-height: 1.6; max-width: 760px; }
    .message { border: 1px solid rgba(0,0,0,.12); border-radius: 8px; background: rgba(255,255,255,.72); margin: 14px 0; padding: 16px; }
    .message.assistant { border-left: 4px solid #2563eb; }
    .message.user { border-left: 4px solid #0f766e; }
    .message.system { border-left: 4px solid #737373; }
    .meta { display: flex; gap: 12px; justify-content: space-between; color: #676760; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    pre { margin: 12px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.6; }
    .empty, .runs { margin-top: 28px; color: #676760; }
    .runs h2 { font-size: 16px; margin: 0 0 12px; }
    .runs ol { margin: 0; padding-left: 20px; }
    .runs li { margin: 8px 0; }
    .runs span { color: #676760; margin-left: 8px; }
    @media (prefers-color-scheme: dark) {
      :root { background: #11110f; color: #f5f5ef; }
      header, .message { border-color: rgba(255,255,255,.15); }
      .message { background: rgba(255,255,255,.06); }
      .summary, .eyebrow, .meta, .empty, .runs, .runs span { color: #b9b9ad; }
    }
    @media (max-width: 640px) {
      h1 { font-size: 32px; }
      main { width: min(100vw - 24px, 920px); padding-top: 32px; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Read-only shared agent session</p>
      <h1>${escapeSharedThreadHtml(title)}</h1>
      <p class="summary">${escapeSharedThreadHtml(thread.preview || `${thread.messageCount} message${thread.messageCount === 1 ? "" : "s"}`)}</p>
    </header>
    ${messages || '<p class="empty">No transcript messages were shared.</p>'}
    ${runsHtml}
  </main>
</body>
</html>`;
}

function renderSharedThreadErrorHtml(status: number, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex, nofollow" /><title>${status} ${escapeSharedThreadHtml(message)}</title><style>body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f7f5;color:#1d1d1b}main{max-width:720px;margin:0 auto;padding:64px 24px}p{color:#676760;line-height:1.6}@media(prefers-color-scheme:dark){body{background:#11110f;color:#f5f5ef}p{color:#b9b9ad}}</style></head><body><main><h1>${status}</h1><p>${escapeSharedThreadHtml(message)}</p></main></body></html>`;
}

function sharedThreadError(event: H3Event, status: number, message: string) {
  setResponseStatus(event, status);
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "X-Robots-Tag", "noindex, nofollow");
  if (wantsSharedThreadHtml(event)) {
    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
    return renderSharedThreadErrorHtml(status, message);
  }
  return { error: message };
}

export async function handleSharedThreadRequest(
  event: H3Event,
  deps: SharedThreadRouteDependencies,
) {
  const method = getMethod(event);
  if (method !== "GET") {
    return sharedThreadError(event, 405, "Method not allowed");
  }

  const token = parseSharedThreadToken(event);
  if (!token) {
    return sharedThreadError(event, 400, "Share token is required");
  }

  const thread = await deps.getThreadByShareToken(token);
  if (!thread) {
    return sharedThreadError(event, 404, "Shared thread not found");
  }

  const runs = await deps.listRunsForThread(thread.id, { limit: 10 });
  const payload = {
    thread: sanitizeSharedThread(thread),
    runs,
  };
  setResponseHeader(event, "Cache-Control", "private, no-store");
  setResponseHeader(event, "X-Robots-Tag", "noindex, nofollow");
  if (wantsSharedThreadHtml(event)) {
    setResponseHeader(event, "Content-Type", "text/html; charset=utf-8");
    return renderSharedThreadHtml(payload.thread, runs);
  }
  setResponseHeader(event, "Content-Type", "application/json");
  return payload;
}

function sanitizeSharedMessage(entry: unknown): {
  id?: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt?: string | number;
} | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const message =
    raw.message && typeof raw.message === "object"
      ? (raw.message as Record<string, unknown>)
      : raw;
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }
  const text = sharedTextFromContent(message.content).trim();
  if (!text) return null;
  const id = typeof message.id === "string" ? message.id : undefined;
  const createdAt =
    typeof message.createdAt === "string" ||
    typeof message.createdAt === "number"
      ? message.createdAt
      : undefined;
  return {
    ...(id ? { id } : {}),
    role,
    text,
    ...(createdAt !== undefined ? { createdAt } : {}),
  };
}

function sharedTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const r = part as Record<string, unknown>;
    if (r.type !== "text") continue;
    if (typeof r.text === "string") parts.push(r.text);
  }
  return parts.join("");
}

function parseSharedThreadToken(event: H3Event): string | null {
  const candidates = [event.path, event.node?.req?.url].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  for (const candidate of candidates) {
    const path = candidate.split("?")[0];
    const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
    const sharedIndex = parts.lastIndexOf("shared");
    if (sharedIndex >= 0 && parts[sharedIndex + 1]) {
      return decodeURIComponent(parts[sharedIndex + 1]);
    }
    if (parts[0]) return decodeURIComponent(parts[0]);
  }
  return null;
}

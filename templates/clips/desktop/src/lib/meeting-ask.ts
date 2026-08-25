// Live agent transport for the meeting pill's ask sheet.
//
// Posts to the framework agent-chat surface (`POST /_agent-native/agent-chat`)
// — the same lane the web chat uses — and hand-parses its SSE response instead
// of importing the full assistant-ui adapter (bundle weight matters in
// overlays). The protocol is simple enough to parse safely: each frame is
// `data: {AgentChatEvent JSON}\n\n`, `: ping` comment lines are keepalives,
// `text` events carry APPEND deltas, and `done` / `error` / `loop_limit` /
// `auto_continue` / `missing_api_key` terminate the stream server-side.
//
// Auth rides on the window-wide fetch interceptor (installed in main.tsx),
// which attaches the desktop bearer token and X-Request-Source marker to any
// request targeting the stored server origin — the same pattern the popover's
// `callClipsAction` relies on.

/** One completed exchange, in the agent-chat request's `history` shape. */
export interface AskTurn {
  role: "user" | "assistant";
  content: string;
}

/** Bound the request payload: pill asks are short, so a small tail is plenty. */
export const MAX_ASK_HISTORY_TURNS = 12;

// The server pings every 10s even while tools run, so a minute of silence
// means the transport is dead, not that the agent is thinking.
const STREAM_INACTIVITY_TIMEOUT_MS = 60_000;

/**
 * Scaffolding sent to the model. The visible bubble shows only the raw
 * question (`displayMessage`); this framing keeps the agent scoped to the
 * active meeting and steers it to the meeting actions for the transcript.
 */
export function buildMeetingAskPrompt(
  meetingId: string,
  meetingTitle: string | null | undefined,
  question: string,
): string {
  const title = meetingTitle?.trim();
  const label = title ? ` ("${title}")` : "";
  return [
    `You are answering a quick question asked from inside the live meeting ${meetingId}${label}.`,
    `First read the meeting with the get-meeting action (id ${meetingId}) — transcript, notes, attendees — and use search-meetings only if the question needs related meetings.`,
    `Answer from the meeting content in short plain text for a small overlay: no headings, no tables. Stay scoped to this meeting.`,
    "",
    `Question: ${question}`,
  ].join("\n");
}

/**
 * Ask the live agent about a meeting and stream the answer.
 *
 * Resolves with the full answer text once the run finishes; every `text`
 * delta is forwarded to `onTextDelta` as it arrives. Rejects on transport,
 * auth, or agent errors — and on `opts.signal` abort, in which case
 * `opts.signal.aborted` is true so callers can stay silent.
 */
export async function streamMeetingAsk(opts: {
  serverUrl: string;
  meetingId: string;
  meetingTitle?: string | null;
  question: string;
  history: AskTurn[];
  signal: AbortSignal;
  onTextDelta: (delta: string) => void;
}): Promise<string> {
  const base = opts.serverUrl.replace(/\/+$/, "");
  // Watchdog shares one controller with the caller's signal; `timedOut` tells
  // a dead-transport abort apart from the caller dismissing the sheet.
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
  opts.signal.addEventListener("abort", abortFromCaller, { once: true });
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const kickWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  try {
    kickWatchdog();
    const res = await fetch(`${base}/_agent-native/agent-chat`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Scaffolded prompt for the model; raw question for persisted display.
        message: buildMeetingAskPrompt(
          opts.meetingId,
          opts.meetingTitle,
          opts.question,
        ),
        displayMessage: opts.question,
        history: opts.history.slice(-MAX_ASK_HISTORY_TURNS),
        usageLabel: "meeting-pill",
        // No threadId on purpose: the server only claims a per-thread run slot
        // (and 409s concurrent asks) when one is sent; continuity comes from
        // the client-carried `history` instead.
      }),
      signal: controller.signal,
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/event-stream")) {
      // coercion-ok: already the failure path — an unreadable error body still
      // ends in the thrown generic error line below, never a silent success.
      const text = await res.text().catch(() => "");
      let serverMessage = "";
      try {
        const json = JSON.parse(text) as { error?: unknown; message?: unknown };
        const candidate = json?.error ?? json?.message;
        serverMessage = typeof candidate === "string" ? candidate : "";
      } catch {
        // coercion-ok: non-JSON error body — the generic line below is thrown.
      }
      throw new Error(
        serverMessage.slice(0, 200) ||
          (res.status === 401
            ? "Sign in to ask about meetings."
            : `Couldn't reach the agent (${res.status}). Try again.`),
      );
    }
    if (!res.body) throw new Error("The agent response had no stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let answer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        kickWatchdog();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let ev: { type?: string; text?: string; error?: string };
          try {
            ev = JSON.parse(raw);
          } catch {
            continue;
          }
          if (ev.type === "text" && ev.text) {
            answer += ev.text;
            opts.onTextDelta(ev.text);
          } else if (ev.type === "error") {
            throw new Error(
              (ev.error || "The agent hit an error. Try again.").slice(0, 200),
            );
          } else if (ev.type === "missing_api_key") {
            throw new Error("The agent has no model credentials configured.");
          }
          // `done`, `loop_limit`, and `auto_continue` all close the stream
          // server-side; whatever text streamed by then is the answer.
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    if (!answer.trim()) {
      throw new Error("The agent didn't answer. Try again.");
    }
    return answer;
  } catch (err) {
    if (timedOut && !opts.signal.aborted) {
      throw new Error("The agent stopped responding. Try again.");
    }
    if (
      !opts.signal.aborted &&
      err instanceof TypeError // fetch network failure
    ) {
      throw new Error("Couldn't reach the agent. Try again.");
    }
    throw err;
  } finally {
    if (watchdog) clearTimeout(watchdog);
    opts.signal.removeEventListener("abort", abortFromCaller);
  }
}

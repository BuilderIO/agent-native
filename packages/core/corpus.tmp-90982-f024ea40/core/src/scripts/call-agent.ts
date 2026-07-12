import { createHash } from "node:crypto";

import {
  A2ATaskTimeoutError,
  callAgent,
  shouldPreferGlobalA2ASecret,
  signA2AToken,
} from "../a2a/client.js";
import type { Task } from "../a2a/types.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
} from "../agent/engine/credential-errors.js";
import type { ActionRunContext } from "../agent/production-agent.js";
import type { ActionTool } from "../agent/types.js";
import { A2A_CONTINUATION_QUEUED_MARKER } from "../integrations/a2a-continuation-marker.js";
import { getOrgDomain, getOrgA2ASecret } from "../org/context.js";
import { findAgent, discoverAgents } from "../server/agent-discovery.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
  isIntegrationCallerRequest,
  getIntegrationRequestContext,
} from "../server/request-context.js";

const DEFAULT_SERVERLESS_INTEGRATION_A2A_TIMEOUT_MS = 18_000;
const NETLIFY_INTEGRATION_A2A_TIMEOUT_MS = 2_000;
const INTEGRATION_A2A_TOKEN_TTL = "30m";

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function isServerlessHost(): boolean {
  // Detection mirrors db/migrations.ts:297-301. On Cloudflare Workers/Pages,
  // `process.env` is shimmed and CF_PAGES isn't reliably populated at runtime —
  // the canonical signal is the `__cf_env` global injected by workerd.
  return (
    !!process.env.NETLIFY ||
    !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
    !!process.env.VERCEL ||
    "__cf_env" in globalThis
  );
}

function getIntegrationCallTimeoutMs(): number | undefined {
  if (!isServerlessHost() || !isIntegrationCallerRequest()) return undefined;

  const configured = parseTimeoutMs(
    process.env.AGENT_NATIVE_INTEGRATION_A2A_TIMEOUT_MS,
  );
  if (configured !== undefined) return configured;

  // Netlify's current synchronous function budget is 60s. Keep delegated
  // calls very short so multi-agent integration requests queue downstream
  // continuations quickly instead of spending the parent Slack/email processor
  // budget waiting on separately deployed apps one-by-one.
  if (process.env.NETLIFY) return NETLIFY_INTEGRATION_A2A_TIMEOUT_MS;

  return DEFAULT_SERVERLESS_INTEGRATION_A2A_TIMEOUT_MS;
}

function integrationSourceContextHint(): string {
  const integration = getIntegrationRequestContext();
  const incoming = integration?.incoming;
  if (incoming?.platform !== "slack" || !incoming.sourceUrl) return "";

  try {
    const sourceUrl = new URL(incoming.sourceUrl);
    const isSlackHost =
      sourceUrl.hostname === "slack.com" ||
      sourceUrl.hostname.endsWith(".slack.com");
    if (sourceUrl.protocol !== "https:" || !isSlackHost) return "";
    return (
      `\n\n[Source Slack thread: ${sourceUrl.toString()} ` +
      "Preserve this exact URL as request provenance when creating an intake record or other artifact.]"
    );
  } catch {
    return "";
  }
}

function formatDownstreamLlmCredentialFailure(
  agentName: string,
  value: unknown,
): string | null {
  return isLlmCredentialError(value)
    ? formatLlmCredentialErrorMessage({ agentName })
    : null;
}

export const tool: ActionTool = {
  description:
    "Call a DIFFERENT, separately-deployed agent app to ask a question or delegate a task. This is strictly for cross-app A2A communication — for example, asking the mail agent to send an email while you are the calendar agent. NEVER use this to call your own app or perform actions you can do with your own tools. Using call-agent on yourself will fail and waste time. " +
    'For brand-consistent generated media, the first-party Assets agent is available as agent="assets"; use it when another app needs generated heroes, diagrams, product shots, thumbnails, videos, or design imagery, unless the current app has its own generation action that already delegates there. ' +
    "IMPORTANT — handling the response: " +
    "(a) If it contains a URL or ID, copy it VERBATIM into your reply. Do not 'correct' or pluralize the path (e.g. /deck/ → /decks/), normalize casing, or change the slug — any edit breaks the link. " +
    '(b) If it does NOT contain a URL/ID and the user asked for one, say so explicitly (e.g. "the agent created the deck/image but didn\'t return a link — open the app directly to view it"). NEVER invent a URL, slug, or path — guessing produces broken links that look real. ' +
    "(c) If the downstream response reports missing credentials, never repeat raw env var names, Vault key names, token names, secret names, or other credential identifiers. Tell the user the target app needs its LLM/provider connection configured.",
  parameters: {
    type: "object",
    properties: {
      agent: {
        type: "string",
        description:
          "Name or URL of a DIFFERENT deployed agent app (e.g. 'mail', 'calendar', 'analytics'). Must not be the current app's own name.",
      },
      message: {
        type: "string",
        description: "The message/question to send to the other agent",
      },
    },
    required: ["agent", "message"],
  },
};

export async function run(
  args: Record<string, string>,
  context?: ActionRunContext,
  selfAppId?: string,
): Promise<string> {
  const { agent: agentIdOrName, message } = args;

  if (!agentIdOrName) return "Error: --agent is required";
  if (!message) return "Error: --message is required";

  // Prevent self-calls — the agent must use its own registered tools instead
  if (selfAppId && agentIdOrName.toLowerCase() === selfAppId.toLowerCase()) {
    return `Error: You cannot use call-agent to call yourself (${selfAppId}). Use your own registered actions/tools instead. call-agent is only for communicating with OTHER separately-deployed apps.`;
  }

  const agent = await findAgent(agentIdOrName, selfAppId);
  if (!agent) {
    const available = (await discoverAgents(selfAppId))
      .map((a) => a.name)
      .join(", ");
    return `Error: Agent "${agentIdOrName}" not found. Available agents: ${available || "(none)"}`;
  }

  // Append a small cross-app hint to the outgoing message so the receiving
  // agent (which may be on an older deploy without the receiver-side hint
  // in handlers.ts) still emits fully-qualified URLs. This is belt-and-
  // suspenders with the receiver hint — but it works against any current
  // deployment, no redeploy required.
  const messageWithHint =
    `${message}${integrationSourceContextHint()}\n\n` +
    `[Note: this request comes from another app via A2A. The caller cannot see your local UI, deck list, or navigation — only the literal text you put in your reply. ` +
    `If you create or reference a deck/document/design/dashboard, include its FULLY-QUALIFIED URL (e.g. ${agent.url}/deck/<id>) in your reply, not a relative path. ` +
    `Use only artifact IDs and URL paths returned by successful actions — never invent slugs, IDs, or hosts.]`;

  try {
    // If we have a send context, use streaming so the UI shows progressive text
    if (context?.send) {
      const callerEmail = getRequestUserEmail();

      // Build metadata with identity
      const a2aMetadata: Record<string, unknown> = {};
      if (callerEmail) a2aMetadata.userEmail = callerEmail;

      // Include org domain for cross-app org resolution
      let callerOrgDomain: string | undefined;
      let callerOrgSecret: string | undefined;
      const orgId = getRequestOrgId();
      if (orgId) {
        try {
          const domain = await getOrgDomain(orgId);
          if (domain) {
            callerOrgDomain = domain;
            a2aMetadata.orgDomain = domain;
          }
        } catch {}
        try {
          const secret = await getOrgA2ASecret(orgId);
          if (secret) callerOrgSecret = secret;
        } catch {}
      }

      // Sign JWT with identity + org domain for the streaming client
      let apiKey: string | undefined;
      if (callerEmail && (callerOrgSecret || process.env.A2A_SECRET)) {
        try {
          apiKey = await signA2AToken(
            callerEmail,
            callerOrgDomain,
            callerOrgSecret,
            {
              expiresIn: INTEGRATION_A2A_TOKEN_TTL,
              preferGlobalSecret: shouldPreferGlobalA2ASecret(callerOrgSecret),
            },
          );
        } catch {}
      }

      if (process.env.NODE_ENV === "production" && callerEmail) {
        try {
          const { listOAuthAccountsByOwner } =
            await import("../oauth-tokens/store.js");
          const accounts = await listOAuthAccountsByOwner(
            "google",
            callerEmail,
          );
          const tokens = accounts[0]?.tokens;
          if (tokens?.access_token) {
            a2aMetadata.googleToken = tokens.access_token;
          }
        } catch {}
      }

      let responseText = "";
      let lastSentLength = 0;
      const existingContinuationText =
        await formatExistingIntegrationContinuationIfRetry(agent, message);
      if (existingContinuationText) return existingContinuationText;

      context.send({
        type: "agent_call",
        agent: agent.name,
        status: "start",
      });

      const emitNewText = (newText: string) => {
        if (newText.length > lastSentLength) {
          context.send!({
            type: "agent_call_text",
            agent: agent.name,
            text: newText.slice(lastSentLength),
          });
          lastSentLength = newText.length;
        }
        responseText = newText;
      };

      // Skip the SSE streaming attempt and go straight to async + poll.
      // Why: on Netlify (Lambda), the receiving server has no streaming
      // response support, so message/stream returns a single JSON-RPC error
      // body in a 200 response that our SSE parser silently consumes — the
      // `for await` loop yields nothing AND keeps the connection open until
      // the function timeout, eating the current serverless budget. By the
      // time we get to the sync fallback, Lambda is dead and the second fetch
      // errors out as "fetch failed". Async+poll has its own short fetches
      // with their own budgets, so it works reliably across hosts. The
      // trade-off is we lose progressive in-UI text streaming for cross-app
      // A2A calls, but the receiving agent's full response still surfaces via
      // the tool_result event below.
      //
      // That trade-off has a second-order cost: callAgent()'s poll (see
      // A2AClient.sendAndWait in a2a/client.ts) can legitimately run for
      // minutes with nothing emitted to the parent between the "start" event
      // above and "done" below. On the parent run, that silence freezes
      // `last_progress_at` — shouldBumpProgressForEvent in
      // agent/run-manager.ts treats a stream of literally nothing as no
      // progress — which trips the client's stuck-detector
      // (DEFAULT_STUCK_THRESHOLD_MS = 90_000 in
      // client/use-run-stuck-detection.ts) and the server's stale-run sweep
      // (BACKGROUND_RUN_STALE_MS = 90_000 in agent/run-store.ts). In
      // production this handed users a "still working, no progress" Retry
      // button that aborted a perfectly healthy call and re-ran the sub-agent
      // from scratch.
      //
      // Fix: surface the REAL remote liveness the poll already gathers. The
      // A2A poll round-trips to the remote agent every ~2s and gets back a
      // task with `status.state` (see A2AClient.sendAndWait / `onUpdate`). We
      // emit an `agent_call_progress` event ONLY from that callback, and ONLY
      // when a poll actually succeeds AND reports an actively-working state.
      // Crucially this is NOT a timer: if the remote hangs or dies, the poll
      // fetch throws, `onUpdate` stops firing, we emit nothing, and the
      // stuck-detector correctly surfaces its banner. A wall-clock heartbeat
      // would instead keep a dead sub-agent looking alive forever — trading a
      // false stuck-positive for a worse false stuck-negative.
      //
      // Throttle: the poll runs every ~2s but both thresholds above are 90s,
      // so emitting per-poll would be ~45 events per stuck-window. We coalesce
      // to at most one emission per 30s — a 3x margin under 90s, so at least
      // two land inside either window even with jitter, without flooding.
      //
      // Shape: a dedicated `agent_call_progress` event type (see
      // agent/types.ts), not an extra `agent_call` status. `agent_call`
      // consumers (production-agent.ts's step summarizer, slack.ts's task
      // cards) render any status that isn't "start"/"done" as a failure, so a
      // "progress" status would surface an in-flight tick as an error. A
      // distinct type is instead ignored gracefully everywhere: the run-event
      // switches fall to their `default`, the client if-chains fall through,
      // and sse-event-processor returns `{action:"continue"}`. It still counts
      // as real progress in shouldBumpProgressForEvent (any non-special event
      // type does), which is the whole point.
      const PROGRESS_MIN_INTERVAL_MS = 30_000;
      // Terminal states resolve the poll; "input-required" means the remote is
      // blocked waiting on us, not making progress. Only actively-working
      // states count as liveness worth surfacing.
      const ACTIVELY_WORKING_STATES = new Set(["working", "submitted"]);
      const callStartedAt = Date.now();
      let lastProgressEmitAt = callStartedAt;
      const onRemotePollUpdate = (task: Task) => {
        const state = task?.status?.state;
        if (!state || !ACTIVELY_WORKING_STATES.has(state)) return;
        const now = Date.now();
        if (now - lastProgressEmitAt < PROGRESS_MIN_INTERVAL_MS) return;
        lastProgressEmitAt = now;
        const detail = extractRemoteProgressDetail(task);
        context.send!({
          type: "agent_call_progress",
          agent: agent.name,
          state,
          elapsedSeconds: Math.round((now - callStartedAt) / 1000),
          ...(detail ? { detail } : {}),
        });
      };

      try {
        // Apply a polling cap ONLY for integration-platform callers on
        // serverless hosts. Normal chat, local Node, self-hosted Node, and
        // Docker can wait for slow-but-valid answers; integration processors
        // still need to finish before their current function execution dies.
        const callTimeoutMs = getIntegrationCallTimeoutMs();
        responseText = await callAgent(agent.url, messageWithHint, {
          apiKey,
          userEmail: callerEmail,
          orgDomain: callerOrgDomain,
          orgSecret: callerOrgSecret,
          onUpdate: onRemotePollUpdate,
          ...(callTimeoutMs
            ? {
                timeoutMs: callTimeoutMs,
                // Integration callers must keep the timeout task id so the
                // catch below can enqueue durable continuation polling.
                returnRecoverableArtifactsOnTimeout: false,
              }
            : {}),
        });
        responseText =
          formatDownstreamLlmCredentialFailure(agent.name, responseText) ??
          responseText;
        // Some agents reply with relative paths (e.g. slides emits
        // "/deck/abc"). Those resolve against the caller's host, not the
        // receiver's, so they're broken for the user. Expand any leading-slash
        // URL into a fully-qualified one rooted at the receiving agent's host.
        responseText = expandRelativeUrls(responseText, agent.url);
        // Mirror the response into the streaming UI so the user sees it.
        if (responseText) emitNewText(responseText);
      } catch (pollErr: any) {
        const timeoutTaskId = getA2ATaskTimeoutTaskId(pollErr);
        if (timeoutTaskId) {
          const queued = await enqueueIntegrationContinuationIfPossible(
            timeoutTaskId,
            agent,
            message,
            callerEmail,
          );
          if (queued) {
            responseText =
              `${A2A_CONTINUATION_QUEUED_MARKER}\n` +
              `The ${agent.name} agent accepted this delegated subtask and will post its own final result to the originating integration thread automatically. ` +
              `Do not call ${agent.name} again for this same subtask. Continue any other requested work, then answer with the completed results you have; if needed, mention that ${agent.name} is posting its result separately.`;
          } else {
            // The normal integration path must preserve the timeout task id so
            // it can enqueue a durable continuation. If that enqueue fails,
            // do not hide receiver-verified artifacts that were already
            // returned with the last poll; this mirrors callAgent's default
            // timeout behavior without treating arbitrary remote status text
            // as a completed response.
            const recoverableArtifactText =
              extractRecoverableTimeoutArtifactText(pollErr);
            if (recoverableArtifactText) {
              responseText = expandRelativeUrls(
                recoverableArtifactText,
                agent.url,
              );
            } else {
              const reason = pollErr?.message ?? "unknown error";
              responseText = `The ${agent.name} agent is taking longer than expected and didn't reply in time. (${reason})`;
            }
          }
        } else {
          const reason = pollErr?.message ?? "unknown error";
          responseText =
            formatDownstreamLlmCredentialFailure(agent.name, pollErr) ??
            `The ${agent.name} agent is taking longer than expected and didn't reply in time. (${reason})`;
        }
      }

      context.send({
        type: "agent_call",
        agent: agent.name,
        status: "done",
      });

      return responseText || "(empty response)";
    }

    // No context — use the async + poll call so we don't get cut off at the
    // serverless gateway's ~30s timeout. callAgent defaults to async:true.
    const email = getRequestUserEmail();
    let domain: string | undefined;
    let orgSecret: string | undefined;
    const currentOrgId = getRequestOrgId();
    if (currentOrgId) {
      try {
        domain = (await getOrgDomain(currentOrgId)) ?? undefined;
      } catch {}
      try {
        orgSecret = (await getOrgA2ASecret(currentOrgId)) ?? undefined;
      } catch {}
    }
    const response = await callAgent(agent.url, messageWithHint, {
      userEmail: email,
      orgDomain: domain,
      orgSecret,
    });
    const sanitized =
      formatDownstreamLlmCredentialFailure(agent.name, response) ?? response;
    return expandRelativeUrls(sanitized, agent.url) || "(empty response)";
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const credentialMessage = formatDownstreamLlmCredentialFailure(
      agent.name,
      err,
    );
    if (credentialMessage) return credentialMessage;
    // Friendlier message for the common timeout case so the calling agent can
    // decide whether to give up or retry.
    if (/timeout|did not complete|Inactivity|504/i.test(msg)) {
      return `The ${agent.name} agent is taking longer than expected. Please try again, ask a simpler question, or open the ${agent.name} app directly.`;
    }
    return `Error calling ${agent.name}: ${msg}`;
  }
}

async function enqueueIntegrationContinuationIfPossible(
  taskId: string,
  agent: { name: string; url: string },
  message: string,
  ownerEmail: string | undefined,
): Promise<boolean> {
  const integration = getIntegrationRequestContext();
  if (!integration || !ownerEmail) return false;

  try {
    const [{ insertA2AContinuation }, { dispatchA2AContinuation }] =
      await Promise.all([
        import("../integrations/a2a-continuations-store.js"),
        import("../integrations/a2a-continuation-processor.js"),
      ]);
    const continuation = await insertA2AContinuation({
      integrationTaskId: integration.taskId,
      platform: integration.incoming.platform,
      externalThreadId: integration.incoming.externalThreadId,
      incoming: integration.incoming,
      placeholderRef: integration.placeholderRef,
      progressRef: integration.progressRef,
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      agentName: agent.name,
      agentUrl: agent.url,
      dedupeKey: getIntegrationContinuationDedupeKey(message),
      a2aTaskId: taskId,
      // Do not persist the short-lived JWT used for the initial send. The
      // continuation processor can mint a fresh token for each poll.
      a2aAuthToken: null,
    });
    await dispatchA2AContinuation(continuation.id).catch((err) => {
      console.error(
        `[call-agent] Failed to dispatch A2A continuation ${continuation.id}:`,
        err,
      );
    });
    return true;
  } catch (err) {
    console.error("[call-agent] Failed to enqueue A2A continuation:", err);
    return false;
  }
}

// Pull a short human-readable detail from a polled A2A task's status message,
// when the remote includes one, so the progress event can surface a real
// signal (e.g. "Generating hero image…") instead of a bare elapsed counter.
// Bounded so a chatty remote can't push a large payload through the event.
const MAX_PROGRESS_DETAIL_CHARS = 200;
function extractRemoteProgressDetail(task: Task): string | undefined {
  const parts = task.status?.message?.parts;
  if (!parts) return undefined;
  const text = parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  return text.length > MAX_PROGRESS_DETAIL_CHARS
    ? `${text.slice(0, MAX_PROGRESS_DETAIL_CHARS - 1)}…`
    : text;
}

function getA2ATaskTimeoutTaskId(err: unknown): string | null {
  if (err instanceof A2ATaskTimeoutError) return err.taskId;

  const candidate = err as
    | { name?: unknown; taskId?: unknown; message?: unknown }
    | null
    | undefined;
  const message = String(candidate?.message ?? "");
  if (
    candidate?.name === "A2ATaskTimeoutError" &&
    typeof candidate.taskId === "string"
  ) {
    return candidate.taskId;
  }

  const match = message.match(/^A2A task ([^\s]+) did not complete\b/);
  return match?.[1] ?? null;
}

/**
 * Mirrors the A2A client's default timeout recovery for the exceptional case
 * where an integration cannot enqueue a durable continuation. Only an
 * explicitly receiver-marked task message is safe to surface as a completed
 * partial result; ordinary working-state text remains a timeout failure.
 */
function extractRecoverableTimeoutArtifactText(err: unknown): string {
  const candidate = err as
    | { lastTask?: Task | unknown; name?: unknown }
    | null
    | undefined;
  const lastTask =
    err instanceof A2ATaskTimeoutError
      ? err.lastTask
      : candidate?.name === "A2ATaskTimeoutError"
        ? (candidate.lastTask as Task | undefined)
        : undefined;
  const message = lastTask?.status?.message;
  if (!message?.metadata?.agentNativeRecoverableArtifacts) return "";

  return message.parts
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

async function formatExistingIntegrationContinuationIfRetry(
  agent: {
    name: string;
    url: string;
  },
  message: string,
): Promise<string | null> {
  const integration = getIntegrationRequestContext();
  if (!integration || (integration.attempts ?? 1) <= 1) return null;

  try {
    const { getA2AContinuationsForIntegrationTaskAgent } =
      await import("../integrations/a2a-continuations-store.js");
    const continuations = await getA2AContinuationsForIntegrationTaskAgent(
      integration.taskId,
      agent.url,
      getIntegrationContinuationDedupeKey(message),
    );
    const active = continuations.find((continuation) =>
      ["pending", "processing", "delivering", "completed"].includes(
        continuation.status,
      ),
    );
    if (!active) return null;

    const state =
      active.status === "completed"
        ? "already completed this delegated subtask and posted its result to the originating integration thread"
        : "already accepted this delegated subtask and is still working on it for the originating integration thread";
    return (
      `${A2A_CONTINUATION_QUEUED_MARKER}\n` +
      `The ${agent.name} agent ${state}. Do not call ${agent.name} again for this same subtask. Continue any other requested work, then answer with the completed results you have; if needed, mention that ${agent.name} is posting or has posted its result separately.`
    );
  } catch (err) {
    console.error("[call-agent] Failed to inspect existing continuation:", err);
    return null;
  }
}

function getIntegrationContinuationDedupeKey(message: string): string {
  const normalized = message.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex");
}

// Expand bare leading-slash paths (e.g. "/deck/abc") into fully-qualified URLs
// rooted at the receiving agent's host. The receiver doesn't always know it's
// being called cross-app, so it may emit relative paths that resolve against
// the caller's host (broken). Match a path that starts at a word boundary,
// begins with `/`, and has at least one path segment after that. Skip if it
// already looks like a fully-qualified URL.
export function expandRelativeUrls(text: string, agentUrl: string): string {
  if (!text || !agentUrl) return text;
  const base = agentUrl.replace(/\/$/, "");
  // Path must start at boundary (start, whitespace, or punctuation that isn't
  // ':' — to avoid mangling `https://example.com/foo` or markdown link bodies).
  return text.replace(
    /(^|[\s([<"'`])(\/[a-z0-9_-][a-z0-9_/?&=%#.,:-]*)/gi,
    (_match, lead, path) => `${lead}${base}${path}`,
  );
}

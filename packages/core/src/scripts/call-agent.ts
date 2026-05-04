import type { ActionTool } from "../agent/types.js";
import type { ActionRunContext } from "../agent/production-agent.js";
import { findAgent, discoverAgents } from "../server/agent-discovery.js";
import {
  A2AClient,
  A2ATaskTimeoutError,
  callAgent,
  signA2AToken,
} from "../a2a/client.js";
import { A2A_CONTINUATION_QUEUED_MARKER } from "../integrations/a2a-continuation-marker.js";
import {
  formatLlmCredentialErrorMessage,
  isLlmCredentialError,
} from "../agent/engine/credential-errors.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
  isIntegrationCallerRequest,
  getIntegrationRequestContext,
} from "../server/request-context.js";
import { getOrgDomain, getOrgA2ASecret } from "../org/context.js";

const DEFAULT_SERVERLESS_INTEGRATION_A2A_TIMEOUT_MS = 18_000;
const NETLIFY_INTEGRATION_A2A_TIMEOUT_MS = 15_000;
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

  // Netlify's current synchronous function budget is 60s. Keep each delegated
  // call short so multi-agent integration requests can queue continuations for
  // more than one downstream app before the parent function is killed.
  if (process.env.NETLIFY) return NETLIFY_INTEGRATION_A2A_TIMEOUT_MS;

  return DEFAULT_SERVERLESS_INTEGRATION_A2A_TIMEOUT_MS;
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
    "IMPORTANT — handling the response: " +
    "(a) If it contains a URL or ID, copy it VERBATIM into your reply. Do not 'correct' or pluralize the path (e.g. /deck/ → /decks/), normalize casing, or change the slug — any edit breaks the link. " +
    '(b) If it does NOT contain a URL/ID and the user asked for one, say so explicitly (e.g. "the agent created the deck but didn\'t return a link — open the app directly to view it"). NEVER invent a URL, slug, or path — guessing produces broken links that look real. ' +
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
    `${message}\n\n` +
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
              preferGlobalSecret: true,
            },
          );
        } catch {}
      }

      const client = new A2AClient(agent.url, apiKey);

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
          ...(callTimeoutMs ? { timeoutMs: callTimeoutMs } : {}),
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
        if (pollErr instanceof A2ATaskTimeoutError) {
          const queued = await enqueueIntegrationContinuationIfPossible(
            pollErr,
            agent,
            callerEmail,
          );
          if (queued) {
            responseText = `${A2A_CONTINUATION_QUEUED_MARKER}\nThe ${agent.name} agent is still working. Do not send an interim reply to the user; the final result will be posted to the originating integration thread automatically.`;
          } else {
            const reason = pollErr?.message ?? "unknown error";
            responseText = `The ${agent.name} agent is taking longer than expected and didn't reply in time. (${reason})`;
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
  error: A2ATaskTimeoutError,
  agent: { name: string; url: string },
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
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      agentName: agent.name,
      agentUrl: agent.url,
      a2aTaskId: error.taskId,
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
    /(^|[\s(\[<"'`])(\/[a-z0-9_-][a-z0-9_/?&=%#.,:-]*)/gi,
    (_match, lead, path) => `${lead}${base}${path}`,
  );
}

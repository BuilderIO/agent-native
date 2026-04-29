import type { ActionTool } from "../agent/types.js";
import type { ActionRunContext } from "../agent/production-agent.js";
import { findAgent, discoverAgents } from "../server/agent-discovery.js";
import { A2AClient, callAgent, signA2AToken } from "../a2a/client.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "../server/request-context.js";
import { getOrgDomain, getOrgA2ASecret } from "../org/context.js";

export const tool: ActionTool = {
  description:
    "Call a DIFFERENT, separately-deployed agent app to ask a question or delegate a task. This is strictly for cross-app A2A communication — for example, asking the mail agent to send an email while you are the calendar agent. NEVER use this to call your own app or perform actions you can do with your own tools. Using call-agent on yourself will fail and waste time.",
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
      // the function timeout, eating the 26s budget. By the time we get to
      // the sync fallback, Lambda is dead and the second fetch errors out
      // as "fetch failed". Async+poll has its own short fetches with their
      // own budgets, so it works reliably across hosts. The trade-off is
      // we lose progressive in-UI text streaming for cross-app A2A calls,
      // but the receiving agent's full response still surfaces via the
      // tool_result event below.
      try {
        console.log(
          `[call-agent] dispatching to ${agent.name} url=${agent.url} caller=${callerEmail} orgDomain=${callerOrgDomain} hasOrgSecret=${!!callerOrgSecret} hasEnvSecret=${!!process.env.A2A_SECRET}`,
        );
        responseText = await callAgent(agent.url, message, {
          userEmail: callerEmail,
          orgDomain: callerOrgDomain,
          orgSecret: callerOrgSecret,
        });
        // Mirror the response into the streaming UI so the user sees it.
        if (responseText) emitNewText(responseText);
      } catch (pollErr: any) {
        // Verbose log so we can see what actually broke when this returns
        // the "didn't reply in time" fallback. errors of cause:
        //   * fetch failed → network/DNS/TLS — log .cause for details
        //   * 401/403 → JWT mismatch, look at sign secret vs receiver env
        //   * timeout/Inactivity → analytics handler exceeded poll budget
        console.error(
          `[call-agent] dispatch to ${agent.name} failed: name=${pollErr?.name} message=${pollErr?.message} cause=${JSON.stringify(pollErr?.cause)?.substring(0, 300)} stack=${pollErr?.stack?.substring(0, 500)}`,
        );
        const reason = pollErr?.message ?? "unknown error";
        responseText = `The ${agent.name} agent is taking longer than expected and didn't reply in time. (${reason})`;
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
    const response = await callAgent(agent.url, message, {
      userEmail: email,
      orgDomain: domain,
      orgSecret,
    });
    return response || "(empty response)";
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    // Friendlier message for the common timeout case so the calling agent can
    // decide whether to give up or retry.
    if (/timeout|did not complete|Inactivity|504/i.test(msg)) {
      return `The ${agent.name} agent is taking longer than expected. Please try again, ask a simpler question, or open the ${agent.name} app directly.`;
    }
    return `Error calling ${agent.name}: ${msg}`;
  }
}

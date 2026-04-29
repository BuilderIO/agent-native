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

      let streamErr: any = null;
      try {
        for await (const task of client.stream(
          {
            role: "user",
            parts: [{ type: "text", text: message }],
          },
          Object.keys(a2aMetadata).length > 0
            ? { metadata: a2aMetadata }
            : undefined,
        )) {
          const newText =
            task.status?.message?.parts
              ?.filter(
                (p): p is { type: "text"; text: string } => p.type === "text",
              )
              ?.map((p) => p.text)
              ?.join("") ?? "";
          emitNewText(newText);
        }
      } catch (err: any) {
        streamErr = err;
      }

      // Fall back to sync send if streaming threw OR yielded nothing. The
      // "yielded nothing" case happens on Netlify because the receiving
      // function has no node response stream available, so the streaming
      // endpoint replies with a JSON-RPC error body in a single 200 response
      // that our SSE parser silently skips (no `data: ` lines).
      if (!responseText) {
        try {
          responseText = await callAgent(agent.url, message, {
            userEmail: callerEmail,
            orgDomain: callerOrgDomain,
            orgSecret: callerOrgSecret,
          });
          // Mirror the response into the streaming UI so the user sees it.
          if (responseText) emitNewText(responseText);
        } catch (pollErr: any) {
          const reason =
            pollErr?.message ?? streamErr?.message ?? "unknown error";
          responseText = `The ${agent.name} agent is taking longer than expected and didn't reply in time. (${reason})`;
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

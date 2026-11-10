import { fail } from "../action.js";
import { isReadOnlyProviderPost } from "./read-only-requests.js";

/**
 * Built-in providers the generic agent request tools may only read. Writes go
 * through the provider's MCP tools or app-defined actions, which can enforce
 * their own limits; server code calling `executeRequest` is unaffected.
 *
 * Kept out of `./index.js` so the shared request action only needs types from
 * the runtime module, and template specs that mock it keep working.
 */
const AGENT_READ_ONLY_PROVIDERS: ReadonlySet<string> = new Set(["hubspot"]);

/** Whether agent-supplied provider requests are limited to reads for a provider. */
export function providerApiAgentRequestsReadOnly(provider: string): boolean {
  return AGENT_READ_ONLY_PROVIDERS.has(provider);
}

/**
 * Refuse a write in a request an agent supplied for a read-only provider.
 * Every agent-facing action that forwards a caller-built request (request,
 * corpus jobs) calls this before executing or storing it.
 */
export function assertAgentProviderRequestAllowed(request: {
  provider: string;
  method?: string | null;
  path: string;
  body?: unknown;
}): void {
  if (!providerApiAgentRequestsReadOnly(String(request.provider))) return;
  const method = String(request.method ?? "GET").toUpperCase();
  if (
    method === "GET" ||
    method === "HEAD" ||
    isReadOnlyProviderPost(request)
  ) {
    return;
  }
  fail(
    `${String(request.provider)} requests from agent tools are read-only. Make the change with the provider's MCP tools or an app action built for it.`,
    { errorCode: "provider_writes_not_allowed", statusCode: 403 },
  );
}

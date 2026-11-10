import { getAppConfig } from "../../app-config/index.js";
import { readDeployCredentialEnv } from "../../server/credential-provider.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../server/request-context.js";
import {
  resolveChatEngine,
  resolveOwnerEngineApiKey,
} from "../production-agent.js";
import {
  isResolvedEngineUsableForRequest,
  registerBuiltinEngines,
} from "./index.js";

/**
 * Whether the current request's user can run a chat model: Builder, a provider
 * key of their own, or a deployment key. A connected Builder account counts
 * even when its credits are spent: that is a top-up problem, not a missing
 * model. "unknown" means the engine or its credential could not be resolved,
 * which is not the same as having none.
 */
export type ChatModelAvailability = "available" | "unavailable" | "unknown";

export async function resolveChatModelAvailability(): Promise<ChatModelAvailability> {
  // Credentials and the default-engine setting are both read in the request's
  // scope, so only the request user can be checked; with none, there is no one
  // whose model to look up, which is "unknown", never "unavailable".
  const userEmail = getRequestUserEmail();
  if (!userEmail) return "unknown";
  const orgId = getRequestOrgId() ?? null;
  try {
    registerBuiltinEngines();
    const credentialIdentity = { userEmail, orgId };
    const anthropicFallback = readDeployCredentialEnv("ANTHROPIC_API_KEY");
    const ownerKey = await resolveOwnerEngineApiKey({
      ownerEmail: userEmail,
      ...(anthropicFallback ? { anthropicFallback } : {}),
    });
    const appId = getAppConfig().app.id ?? getAppConfig().app.template;
    const engine = await resolveChatEngine({
      ownerKey,
      ...(appId ? { appId } : {}),
      credentialIdentity,
    });
    return (await isResolvedEngineUsableForRequest(engine, {
      ...(ownerKey.apiKey ? { apiKey: ownerKey.apiKey } : {}),
      credentialIdentity,
    }))
      ? "available"
      : "unavailable";
  } catch (error) {
    console.warn(
      "[chat-model-availability] could not resolve the chat engine:",
      error instanceof Error ? error.message : error,
    );
    return "unknown";
  }
}

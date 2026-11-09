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

// Resolving reads the credential store and the engine setting. One clip's
// title run and the polled request list ask several times a second, and an
// answer only changes when the user connects or removes a model.
const AVAILABILITY_TTL_MS = 5_000;
const availabilityCache = new Map<
  string,
  { at: number; value: Promise<ChatModelAvailability> }
>();

export function resetChatModelAvailabilityCache(): void {
  availabilityCache.clear();
}

export async function resolveChatModelAvailability(
  input: { ownerEmail?: string | null | undefined } = {},
): Promise<ChatModelAvailability> {
  // Background callers pass the owner; without either there is no one whose
  // credentials to check, which is "unknown", never "unavailable".
  const userEmail = input.ownerEmail ?? getRequestUserEmail();
  if (!userEmail) return "unknown";
  // The request's org belongs to the request user only; a passed owner who is
  // someone else is looked up with no org rather than the wrong one.
  const requestEmail = getRequestUserEmail();
  const orgId =
    requestEmail &&
    requestEmail.trim().toLowerCase() === userEmail.trim().toLowerCase()
      ? (getRequestOrgId() ?? null)
      : null;
  const cacheKey = `${userEmail.trim().toLowerCase()}|${orgId ?? ""}`;
  const cached = availabilityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) {
    return cached.value;
  }
  const now = Date.now();
  for (const [key, entry] of availabilityCache) {
    if (now - entry.at >= AVAILABILITY_TTL_MS) availabilityCache.delete(key);
  }
  const value = resolveUncached(userEmail, orgId);
  availabilityCache.set(cacheKey, { at: Date.now(), value });
  // An unreadable store is not an answer: the next caller asks again.
  void value.then((result) => {
    if (
      result === "unknown" &&
      availabilityCache.get(cacheKey)?.value === value
    ) {
      availabilityCache.delete(cacheKey);
    }
  });
  return value;
}

async function resolveUncached(
  userEmail: string,
  orgId: string | null,
): Promise<ChatModelAvailability> {
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

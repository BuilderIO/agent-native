import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";

import { validateProviderBaseUrl } from "../agent/engine/provider-endpoint-validation.js";
import { OLLAMA_BASE_URL_ENV_VAR } from "../agent/engine/provider-env-vars.js";
import { ssrfSafeFetch } from "../extensions/url-safety.js";
import { getOrgContext } from "../org/context.js";
import { getSession } from "./auth.js";
import {
  isTrustedSelfHostedRuntime,
  resolveSecret,
} from "./credential-provider.js";
import { runWithRequestContext } from "./request-context.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

/**
 * `resolveSecret` reads through the ambient request context set by
 * `runWithRequestContext`, not from this event directly — a plain route
 * handler that never establishes it (unlike action routes, which are wrapped
 * upstream) sees no signed-in user/org, so every saved secret read comes back
 * empty and the caller silently falls back to a default. Mirrors
 * `resolveAgentEngineStatusIdentity` in `core-routes-plugin.ts`.
 */
async function resolveRequestIdentity(
  event: H3Event,
): Promise<{ userEmail: string | undefined; orgId: string | undefined }> {
  // coercion-ok: a session lookup failure here degrades to the unauthenticated
  // path (401, same as no session at all) rather than 500ing this route.
  const session = await getSession(event).catch(() => null);
  const userEmail = session?.email;
  if (!userEmail) return { userEmail: undefined, orgId: undefined };
  try {
    const orgCtx = await getOrgContext(event);
    return { userEmail, orgId: orgCtx.orgId ?? undefined };
  } catch {
    return { userEmail, orgId: undefined };
  }
}

interface OllamaTagsResponse {
  models?: Array<{ name?: unknown }>;
}

function parseModelNames(payload: unknown): string[] {
  const models = (payload as OllamaTagsResponse | null)?.models;
  if (!Array.isArray(models)) return [];
  const names = models
    .map((entry) => (typeof entry?.name === "string" ? entry.name.trim() : ""))
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}

export function createAgentEngineOllamaModelsHandler() {
  return defineEventHandler(async (event: H3Event) => {
    const { userEmail, orgId } = await resolveRequestIdentity(event);
    if (!userEmail) {
      setResponseStatus(event, 401);
      return { error: "Authentication required" };
    }

    const query = getQuery(event);
    const requestedBaseUrl =
      typeof query.baseUrl === "string" ? query.baseUrl.trim() : "";

    return runWithRequestContext({ userEmail, orgId }, async () => {
      const trusted = isTrustedSelfHostedRuntime();
      let baseUrl: string;
      try {
        if (requestedBaseUrl) {
          baseUrl = await validateProviderBaseUrl(requestedBaseUrl, {
            allowLocalOllama: trusted,
            isOllama: true,
          });
        } else {
          const saved = await resolveSecret(OLLAMA_BASE_URL_ENV_VAR);
          baseUrl = await validateProviderBaseUrl(
            saved ?? DEFAULT_OLLAMA_BASE_URL,
            { allowLocalOllama: trusted, isOllama: true },
          );
        }
      } catch (err) {
        setResponseStatus(event, 400);
        return { error: err instanceof Error ? err.message : String(err) };
      }

      try {
        const response = await ssrfSafeFetch(
          `${baseUrl}/api/tags`,
          { signal: AbortSignal.timeout(8_000) },
          { allowedPrivateOrigins: trusted ? [baseUrl] : [] },
        );
        if (!response.ok) {
          setResponseStatus(event, 502);
          return {
            error: `Ollama responded with HTTP ${response.status}. Is the server running at ${baseUrl}?`,
          };
        }
        const models = parseModelNames(await response.json());
        return { ok: true, models };
      } catch {
        setResponseStatus(event, 502);
        return {
          error: `Could not reach Ollama at ${baseUrl}. Check that it's running and the address is correct.`,
        };
      }
    });
  });
}

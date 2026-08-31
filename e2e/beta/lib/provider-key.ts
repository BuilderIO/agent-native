import type { BrowserContext } from "@playwright/test";

/**
 * Install the dedicated e2e OpenAI key for the signed-in identity.
 *
 * The key is written at **user** scope, against the e2e account only. That is
 * the whole point of a separate key: every luna turn this suite runs bills to a
 * credential nobody else uses, so the spend is attributable and can carry its
 * own limit.
 *
 * Two things this must never do, both of which would charge real users:
 *   - a site-level OPENAI_API_KEY env var, which every visitor to that beta
 *     host would then spend against (and which the repo's Netlify env guard
 *     rejects anyway);
 *   - an org-scoped write, which sets the default for everyone in the org.
 */

const KEY_ROUTE = "/_agent-native/agent-engine/api-key";
const ENGINE_STATUS_ROUTE = "/_agent-native/agent-engine/status";
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_E2E_MODEL = "gpt-5.6-luna";
const OPENAI_VALIDATION_TIMEOUT_MS = 15_000;

export type KeySource = "dedicated" | "shared";

export interface ResolvedOpenAiKey {
  key: string;
  source: KeySource;
}

/**
 * Which OpenAI credential this run will bill.
 *
 * `BETA_E2E_OPENAI_API_KEY` is the intended one: created for this suite, with
 * its own spend limit, so agent-turn cost is separately attributable. The
 * repository's shared `OPENAI_API_KEY` also works, but pools this suite's spend
 * with everything else that uses it — which is the thing a dedicated key
 * exists to avoid. It is therefore never picked up implicitly: a run must ask
 * for it, and every caller reports which source it got.
 */
export function resolveOpenAiKey(): ResolvedOpenAiKey | undefined {
  const allowShared = /^(1|true)$/i.test(
    process.env.BETA_E2E_ALLOW_SHARED_KEY?.trim() ?? "",
  );

  // Resolve the explicitly selected source first. A shared dispatch must not
  // silently fall back to the dedicated key, or the run will bill the wrong
  // credential while reporting a successful setup.
  if (allowShared) {
    const shared = process.env.BETA_E2E_SHARED_OPENAI_API_KEY?.trim();
    return shared ? { key: shared, source: "shared" } : undefined;
  }

  const dedicated = process.env.BETA_E2E_OPENAI_API_KEY?.trim();
  if (dedicated) return { key: dedicated, source: "dedicated" };

  return undefined;
}

export interface KeyInstallResult {
  installed: boolean;
  status: number;
  body: string;
  runtimeStatus: {
    status: number;
    body: string;
  };
}

export function isConfirmedOpenAiKeyInstall(
  result: Pick<KeyInstallResult, "status" | "body">,
): boolean {
  if (result.status < 200 || result.status >= 300) return false;
  try {
    const body = JSON.parse(result.body) as {
      ok?: unknown;
      key?: unknown;
      baseUrlKey?: unknown;
      scope?: unknown;
    };
    return (
      body.ok === true &&
      body.key === "OPENAI_API_KEY" &&
      body.baseUrlKey === "OPENAI_BASE_URL" &&
      body.scope === "user"
    );
  } catch {
    return false; // coercion-ok: malformed response is explicitly unconfirmed
  }
}

export function isConfirmedOpenAiEngineStatus(
  result: Pick<KeyInstallResult["runtimeStatus"], "status" | "body">,
): boolean {
  if (result.status < 200 || result.status >= 300) return false;
  try {
    const body = JSON.parse(result.body) as {
      configured?: unknown;
      engine?: unknown;
    };
    return body.configured === true && body.engine === "ai-sdk:openai";
  } catch {
    return false; // coercion-ok: malformed response is explicitly unconfirmed
  }
}

/** Validate the exact credential once before installing it on any beta host. */
export async function validateOpenAiKey(apiKey: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(OPENAI_MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(OPENAI_VALIDATION_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Could not validate the selected OpenAI credential: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `OpenAI rejected the selected credential (HTTP ${response.status}).`,
      );
    }
    throw new Error(
      `OpenAI credential validation was inconclusive (HTTP ${response.status}).`,
    );
  }

  let execution: Response;
  try {
    execution = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_E2E_MODEL,
        input: "Reply with OK.",
        max_output_tokens: 16,
        store: false,
      }),
      signal: AbortSignal.timeout(OPENAI_VALIDATION_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Could not validate the selected OpenAI credential for ${OPENAI_E2E_MODEL}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (execution.ok) return;
  if (execution.status === 401 || execution.status === 403) {
    throw new Error(
      `OpenAI rejected the selected credential for ${OPENAI_E2E_MODEL} (HTTP ${execution.status}).`,
    );
  }
  throw new Error(
    `OpenAI could not validate the selected credential for ${OPENAI_E2E_MODEL} (HTTP ${execution.status}).`,
  );
}

/**
 * POST the key from inside a loaded page on the target origin. Same-origin is
 * required: the framework rejects a cross-origin credential write.
 */
export async function installOpenAiKey(
  context: BrowserContext,
  origin: string,
  apiKey: string,
): Promise<KeyInstallResult> {
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const result = await page.evaluate(
      async ([route, statusRoute, key, baseUrl]) => {
        const response = await fetch(route, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "openai",
            value: key,
            baseUrl,
            scope: "user",
          }),
        });
        const install = {
          status: response.status,
          body: (await response.text()).slice(0, 400),
        };
        const runtime = await fetch(statusRoute, {
          cache: "no-store",
        });
        return {
          ...install,
          runtimeStatus: {
            status: runtime.status,
            body: (await runtime.text()).slice(0, 400),
          },
        };
      },
      [
        KEY_ROUTE,
        ENGINE_STATUS_ROUTE,
        apiKey,
        OPENAI_DEFAULT_BASE_URL,
      ] as const,
    );
    return {
      installed:
        isConfirmedOpenAiKeyInstall(result) &&
        isConfirmedOpenAiEngineStatus(result.runtimeStatus),
      status: result.status,
      body: result.body,
      runtimeStatus: result.runtimeStatus,
    };
  } finally {
    await page.close();
  }
}

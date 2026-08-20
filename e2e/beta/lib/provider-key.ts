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
      async ([route, key]) => {
        const response = await fetch(route, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider: "openai",
            value: key,
            scope: "user",
          }),
        });
        return {
          status: response.status,
          body: (await response.text()).slice(0, 400),
        };
      },
      [KEY_ROUTE, apiKey] as const,
    );
    return {
      installed: result.status >= 200 && result.status < 300,
      status: result.status,
      body: result.body,
    };
  } finally {
    await page.close();
  }
}

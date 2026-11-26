import type { Page } from "@playwright/test";

export type QaBuildWitness = { sha: string; appBuildId: string };

export async function readQaBuildEvidence(
  page: Pick<Page, "evaluate">,
  appBase: string,
  expectedEmail: string,
): Promise<QaBuildWitness | null> {
  try {
    return await page.evaluate(
      async ({ base, email }) => {
        const health = new URL(base + "/_agent-native/health");
        if (health.origin !== window.location.origin) return null;
        const options = {
          cache: "no-store" as const,
          credentials: "same-origin" as const,
          redirect: "error" as const,
          signal: AbortSignal.timeout(5_000),
        };
        const [response, session] = await Promise.all([
          fetch(health, options),
          fetch(base + "/_agent-native/auth/session", options),
        ]);
        if (!response.ok || !session.ok) return null;
        const activeEmail = (await session.json())?.email;
        if (
          typeof activeEmail !== "string" ||
          activeEmail.toLowerCase() !== email
        )
          return null;
        const sha = response.headers.get("x-agent-native-build-sha");
        const appBuildId = response.headers.get("x-agent-native-app-build-id");
        const renderedId = (
          globalThis as typeof globalThis & {
            __AGENT_NATIVE_BUILD_ID__?: string;
          }
        ).__AGENT_NATIVE_BUILD_ID__;
        return sha &&
          /^[a-f0-9]{40}$/.test(sha) &&
          appBuildId &&
          /^content-[a-f0-9]{32}$/.test(appBuildId) &&
          appBuildId === renderedId
          ? { sha, appBuildId }
          : null;
      },
      { base: appBase, email: expectedEmail },
    );
  } catch {
    return null;
  }
}

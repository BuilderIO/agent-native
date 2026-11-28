import type { BrowserContext } from "@playwright/test";

import {
  attemptsFor,
  describeActionFailure,
  isSuccessStatus,
  retryTransientAction,
} from "./action-retry";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./test-traffic";

const APP_ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
};

export async function postActionAsApp(
  context: BrowserContext,
  origin: string,
  name: string,
  input: Record<string, unknown>,
  { attempts = attemptsFor(name) }: { attempts?: number } = {},
): Promise<unknown> {
  const app = await context.newPage();
  try {
    await app.goto(`${origin}/_agent-native/auth/session`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const { final, history } = await retryTransientAction(
      () =>
        app.evaluate(
          async ({ name, input, headers }) => {
            try {
              const minted = await fetch("/_agent-native/ui-capability", {
                credentials: "same-origin",
                cache: "no-store",
              });
              if (!minted.ok) {
                return {
                  status: minted.status,
                  body: `ui-capability: ${await minted.text()}`,
                };
              }
              await minted.arrayBuffer();
              const response = await fetch(`/_agent-native/actions/${name}`, {
                method: "POST",
                credentials: "same-origin",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify(input),
              });
              return { status: response.status, body: await response.text() };
            } catch (error) {
              return {
                status: 0,
                body: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { name, input, headers: APP_ACTION_HEADERS },
        ),
      { attempts },
    );
    if (!isSuccessStatus(final.status)) {
      throw new Error(describeActionFailure(name, history));
    }
    return JSON.parse(final.body);
  } finally {
    await app.close();
  }
}

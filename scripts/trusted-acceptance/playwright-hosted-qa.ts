import type { Browser, BrowserContext, Page } from "@playwright/test";

import type { HostedQaBrowserAdapter } from "./hosted-oauth-a2a-harness.ts";

type JsonResponse = {
  status(): number;
  json(): Promise<unknown>;
};

export type PlaywrightQaPage = Pick<Page, "goto" | "locator"> & {
  request: {
    post(url: string, options: { data: unknown }): Promise<JsonResponse>;
    get(url: string): Promise<JsonResponse>;
  };
};

function exactAcceptanceOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    !/(?:^|[-.])acceptance(?:[-.]|$)/i.test(url.hostname) ||
    /(?:^|[-.])(?:prod|production)(?:[-.]|$)/i.test(url.hostname)
  ) {
    throw new Error("Playwright QA requires an exact acceptance HTTPS origin");
  }
  return url.origin;
}

/**
 * Adapts one Playwright browser context to the generic hosted-QA seam. The
 * context owns the HTTP-only session cookie; this adapter never reads it.
 */
export function createPlaywrightHostedQaBrowser(
  page: PlaywrightQaPage,
  appOrigin: string,
): HostedQaBrowserAdapter {
  const origin = exactAcceptanceOrigin(appOrigin);
  return {
    origin,
    async postJson(path, body) {
      const response = await page.request.post(
        new URL(path, origin).toString(),
        {
          data: body,
        },
      );
      return { status: response.status() };
    },
    async getJson(path) {
      const response = await page.request.get(new URL(path, origin).toString());
      if (response.status() !== 200) {
        throw new Error(
          `hosted QA session check failed with HTTP ${response.status()}`,
        );
      }
      return response.json();
    },
    async authorize(authorizationUrl) {
      const endpoint = new URL(authorizationUrl);
      if (endpoint.origin !== origin) {
        throw new Error("OAuth authorization left the exact acceptance origin");
      }
      await page.goto(endpoint.toString(), { waitUntil: "domcontentloaded" });
      await page.locator('button[name="decision"][value="approve"]').click();
    },
    async authorizeExpectRejected(authorizationUrl) {
      const endpoint = new URL(authorizationUrl);
      if (endpoint.origin !== origin)
        throw new Error("OAuth authorization left the exact acceptance origin");
      const response = await page.goto(endpoint.toString(), {
        waitUntil: "domcontentloaded",
      });
      if (!response)
        throw new Error("wrong-audience authorization returned no response");
      return { status: response.status() };
    },
  };
}

export async function createIsolatedQaPage(
  browser: Browser,
  appOrigin: string,
): Promise<{
  context: BrowserContext;
  page: Page;
  adapter: HostedQaBrowserAdapter;
}> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return {
    context,
    page,
    adapter: createPlaywrightHostedQaBrowser(page, appOrigin),
  };
}

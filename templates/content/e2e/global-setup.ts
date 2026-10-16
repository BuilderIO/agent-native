import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, request, type FullConfig } from "@playwright/test";

import { isAutozQaEmail } from "../../../packages/core/src/shared/qa-test-email";
import { AUTH_FILES, RUN_EMAIL as EMAIL } from "./auth-files";
import { AgentClient, signInAccount, type SignInResult } from "./helpers";
import { expectRunServer } from "./server-identity";

if (!isAutozQaEmail(EMAIL)) {
  throw new Error("CONTENT_E2E_EMAIL must contain +autoz.");
}
const PASS =
  process.env.CONTENT_E2E_PASS || ["example", "content", "e2e", "pw"].join("-");

async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090";
  // Before anything signs in, so another server on the port never gets this
  // run's accounts.
  const api = await request.newContext();
  try {
    await expectRunServer(api, baseURL);
  } finally {
    await api.dispose();
  }
  mkdirSync(AUTH_FILES.dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  let result: SignInResult | { error: string };
  try {
    result = await signInAccount(page.request, baseURL, {
      email: EMAIL,
      password: PASS,
      name: "E2E Tester",
    });
  } catch (error) {
    result = { error: (error as Error).message };
  }
  const sessionEmail = "sessionEmail" in result ? result.sessionEmail : null;
  // eslint-disable-next-line no-console
  console.log("[content global-setup] auth:", JSON.stringify(result));
  await ctx.storageState({ path: AUTH_FILES.state });
  writeFileSync(AUTH_FILES.email, (sessionEmail ?? EMAIL).trim());
  try {
    if (
      !sessionEmail ||
      !("firstRunStatus" in result) ||
      result.firstRunStatus !== 200
    ) {
      throw new Error(
        `[content global-setup] sign-in or first-run setup failed, so authed specs would not reach a usable page: ${JSON.stringify(result)}`,
      );
    }
    await AgentClient.connectShared(page);
    // A dev server compiles each route on its first request, which can outlast
    // the specs' 25 s navigation timeout. CI serves a build it already started.
    if (!process.env.CI)
      for (const route of ["/", "/page/warm-up"])
        await page.goto(route, {
          waitUntil: "domcontentloaded",
          timeout: 180_000,
        });
  } finally {
    await browser.close();
  }
}

export default globalSetup;

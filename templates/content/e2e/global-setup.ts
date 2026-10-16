import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, type FullConfig } from "@playwright/test";

import { isAutozQaEmail } from "../../../packages/core/src/shared/qa-test-email";
import { AgentClient, signInAccount, type SignInResult } from "./helpers";

const EMAIL =
  process.env.CONTENT_E2E_EMAIL ||
  `e2e+autoz-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}@content.test`;
if (!isAutozQaEmail(EMAIL)) {
  throw new Error("CONTENT_E2E_EMAIL must contain +autoz.");
}
const PASS =
  process.env.CONTENT_E2E_PASS || ["example", "content", "e2e", "pw"].join("-");

async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090";
  mkdirSync(".auth", { recursive: true });
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
  await ctx.storageState({ path: ".auth/state.json" });
  writeFileSync(".auth/email.txt", (sessionEmail ?? EMAIL).trim());
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
  } finally {
    await browser.close();
  }
}

export default globalSetup;

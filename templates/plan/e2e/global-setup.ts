import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, type FullConfig } from "@playwright/test";

import { isAutozQaEmail } from "../../../packages/core/src/shared/qa-test-email";
import {
  planE2eAuthDir,
  planE2eAuthEmailPath,
  planE2eAuthStatePath,
  planE2eBaseUrl,
} from "./auth-state";

const EMAIL =
  process.env.PLAN_E2E_EMAIL ||
  `e2e+autoz-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}@plan.test`;
if (!isAutozQaEmail(EMAIL)) {
  throw new Error("PLAN_E2E_EMAIL must contain +autoz.");
}
const PASS =
  process.env.PLAN_E2E_PASS || ["example", "plan", "e2e", "pw"].join("-");

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function globalSetup(_config: FullConfig) {
  const baseURL = planE2eBaseUrl();
  const authDir = planE2eAuthDir(baseURL);
  const authStatePath = planE2eAuthStatePath(baseURL);
  const authEmailPath = planE2eAuthEmailPath(baseURL);
  mkdirSync(authDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let result: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(500 * attempt);
      result = await page.evaluate(
        async ({ email, pass }) => {
          const post = (path: string, body: unknown) =>
            fetch(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }).then(async (r) => ({
              ok: r.ok,
              status: r.status,
              data: (await r.json().catch(() => ({}))) as Record<
                string,
                unknown
              >,
            }));
          let login = await post("/_agent-native/auth/login", {
            email,
            password: pass,
          });
          let regStatus: number | undefined;
          let regErr: unknown;
          if (!login.ok) {
            const reg = await post("/_agent-native/auth/register", {
              email,
              password: pass,
              name: "E2E Tester",
              callbackURL: "/plans",
            });
            regStatus = reg.status;
            regErr = reg.data?.error || reg.data?.message;
            login = await post("/_agent-native/auth/login", {
              email,
              password: pass,
            });
          }
          const sess = await fetch("/_agent-native/auth/session", {
            headers: { Accept: "application/json" },
          })
            .then((r) => r.json())
            .catch(() => ({}));
          return {
            loginOk: login.ok,
            loginStatus: login.status,
            loginErr: login.data?.error || login.data?.message,
            regStatus,
            regErr,
            sessionEmail: (sess as Record<string, unknown>)?.email,
          };
        },
        { email: EMAIL, pass: PASS },
      );
      if (result.sessionEmail) break;
    } catch (error) {
      result = { error: (error as Error).message, attempt };
    }
    if (attempt < 8) await sleep(500 * attempt);
  }
  // eslint-disable-next-line no-console
  console.log("[global-setup] auth:", JSON.stringify(result));
  await ctx.storageState({ path: authStatePath });
  writeFileSync(authEmailPath, String(result.sessionEmail || EMAIL).trim());
  await browser.close();
  if (!result.sessionEmail) {
    // eslint-disable-next-line no-console
    console.warn(
      "[global-setup] WARNING: not authenticated — authed specs will run as guest.",
    );
  }
}

export default globalSetup;

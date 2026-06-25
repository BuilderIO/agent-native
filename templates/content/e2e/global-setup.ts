import { mkdirSync, writeFileSync } from "node:fs";

import { chromium, type FullConfig } from "@playwright/test";

/*
 * Establish a reusable authed session for the "authed" project.
 *
 * Mirrors templates/plan/e2e/global-setup.ts: uses the framework auth API
 * (/_agent-native/auth/{register,login,session}) via a SAME-ORIGIN fetch from a
 * loaded app page (passes Better Auth's origin check). Registers a fresh per-run
 * account (idempotent: falls back to login), then saves the session cookies to
 * e2e/.auth/state.json.
 *
 * A FIXED email deadlocks across a dev-server restart (stored hash no longer
 * verifies under a new BETTER_AUTH_SECRET), so default to a per-run email.
 */
const EMAIL =
  process.env.CONTENT_E2E_EMAIL ||
  `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}@content.test`;
const PASS =
  process.env.CONTENT_E2E_PASS || ["example", "content", "e2e", "pw"].join("-");

async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.CONTENT_BASE_URL || "http://127.0.0.1:8090";
  mkdirSync(".auth", { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let result: Record<string, unknown> = {};
  try {
    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
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
            data: (await r.json().catch(() => ({}))) as Record<string, unknown>,
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
            callbackURL: "/",
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
  } catch (error) {
    result = { error: (error as Error).message };
  }
  // eslint-disable-next-line no-console
  console.log("[content global-setup] auth:", JSON.stringify(result));
  await ctx.storageState({ path: ".auth/state.json" });
  writeFileSync(".auth/email.txt", String(result.sessionEmail || EMAIL).trim());
  await browser.close();
  if (!result.sessionEmail) {
    // eslint-disable-next-line no-console
    console.warn(
      "[content global-setup] WARNING: not authenticated — authed specs will run as guest.",
    );
  }
}

export default globalSetup;

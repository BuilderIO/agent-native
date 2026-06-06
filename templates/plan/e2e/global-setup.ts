import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";

/*
 * Establish a reusable authed session for the "authed" project.
 *
 * Uses the framework auth API (/_agent-native/auth/{register,login,session})
 * via a SAME-ORIGIN fetch from a loaded app page — this passes Better Auth's
 * origin check (a bare programmatic call from another origin is rejected).
 * Registers a fixed test account (idempotent: falls back to login if it already
 * exists), then saves the session cookies to e2e/.auth/state.json.
 *
 * Guest specs opt out of this state via their own empty storageState.
 */
const EMAIL = process.env.PLAN_E2E_EMAIL || "e2e-tester@plan.test";
const PASS =
  process.env.PLAN_E2E_PASS || ["example", "plan", "e2e", "pw"].join("-");

async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.PLAN_BASE_URL || "http://localhost:8081";
  mkdirSync("e2e/.auth", { recursive: true });
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
  } catch (error) {
    result = { error: (error as Error).message };
  }
  // eslint-disable-next-line no-console
  console.log("[global-setup] auth:", JSON.stringify(result));
  await ctx.storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
  if (!result.sessionEmail) {
    // eslint-disable-next-line no-console
    console.warn(
      "[global-setup] WARNING: not authenticated — authed specs will run as guest.",
    );
  }
}

export default globalSetup;

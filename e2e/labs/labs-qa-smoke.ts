import { mkdirSync } from "node:fs";

import { chromium } from "@playwright/test";

import {
  verificationLinkFor,
  waitForVerificationEmail,
} from "../signup/lib/mailosaur.ts";

const app = process.env.LABS_APP?.trim();
const email = process.env.QA_EMAIL?.trim();
const password = process.env.QA_PASSWORD?.trim();

if (!app || !email || !password) {
  throw new Error("LABS_APP, QA_EMAIL, and QA_PASSWORD are required.");
}

const host = (process.env.LABS_HOST?.trim() || "labs.agent-native.com").replace(
  /^https?:\/\//,
  "",
);
const origin = `https://${host}`;
const appUrl = `${origin}/${app}/`;
const artifactDir = `artifacts/labs-qa-${app}`;
mkdirSync(artifactDir, { recursive: true });

async function readSession(context: import("playwright").BrowserContext) {
  const res = await context.request.get(
    `${origin}/${app}/_agent-native/auth/session`,
    {
      headers: { Accept: "application/json" },
      timeout: 30_000,
    },
  );
  if (!res.ok()) return null;
  try {
    return (await res.json()) as { email?: string };
    // coercion-ok: a non-JSON session body means no session to reuse
  } catch {
    return null;
  }
}

async function ensureSignedIn(
  context: import("playwright").BrowserContext,
  page: import("playwright").Page,
) {
  const existing = await readSession(context);
  if (existing?.email === email) return;

  const signInRes = await context.request.post(
    `${origin}/${app}/_agent-native/auth/ba/sign-in/email`,
    {
      data: { email, password },
      headers: { "Content-Type": "application/json" },
      timeout: 30_000,
    },
  );

  if (signInRes.ok()) {
    const session = await readSession(context);
    if (session?.email === email) return;
  }

  const requestedAt = Date.now() - 5_000;
  const signUpRes = await context.request.post(
    `${origin}/${app}/_agent-native/auth/ba/sign-up/email`,
    {
      data: { email, password, name: "QA Fleet" },
      headers: { "Content-Type": "application/json" },
      timeout: 30_000,
    },
  );

  if (!signUpRes.ok()) {
    const text = await signUpRes.text();
    throw new Error(
      `Sign-up failed for ${app} (${signUpRes.status()}): ${text.slice(0, 300)}`,
    );
  }

  let session = await readSession(context);
  if (session?.email === email) return;

  const message = await waitForVerificationEmail(email, requestedAt);
  const link = verificationLinkFor(message, origin);
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const continueBtn = page.locator('form button[type="submit"]');
  if ((await continueBtn.count()) > 0) {
    await continueBtn.click();
    await page.waitForLoadState("networkidle");
  }

  session = await readSession(context);
  if (session?.email !== email) {
    throw new Error(`Session not established for ${app} after verification.`);
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  try {
    await ensureSignedIn(context, page);
    await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${artifactDir}/${app}-loaded.png` });

    const tmpName = `qa-tmp-${Date.now()}`;
    const stateKey = `qa-tmp-smoke-${app}`;
    const putRes = await context.request.put(
      `${origin}/${app}/_agent-native/application-state/${stateKey}`,
      {
        data: { value: { name: tmpName, createdAt: new Date().toISOString() } },
        headers: { "Content-Type": "application/json" },
        timeout: 30_000,
      },
    );
    if (putRes.ok()) {
      const getRes = await context.request.get(
        `${origin}/${app}/_agent-native/application-state/${stateKey}`,
        { timeout: 30_000 },
      );
      if (!getRes.ok()) {
        throw new Error(`Read-back failed for ${app}: ${getRes.status()}`);
      }
      await context.request.delete(
        `${origin}/${app}/_agent-native/application-state/${stateKey}`,
        { timeout: 30_000 },
      );
    }

    await page.screenshot({ path: `${artifactDir}/${app}-after.png` });
    console.log(`PASS ${app} (${email})`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

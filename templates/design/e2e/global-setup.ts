import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

/**
 * Global setup: authenticate a test user (email/password; there is no dev auth
 * bypass) and seed one design with a known fixture HTML so specs run against
 * deterministic content. Writes:
 *   e2e/.auth/state.json  - signed session storageState
 *   e2e/.auth/seed.json   - { designId } of the seeded design
 */

export const E2E_EMAIL = "e2e@local.test";
export const E2E_PASSWORD = "password-e2e-1234";
export const SEED_TITLE = "E2E Seed Design";

const AUTH_DIR = path.join(import.meta.dirname, ".auth");
const STATE_PATH = path.join(AUTH_DIR, "state.json");
const SEED_PATH = path.join(AUTH_DIR, "seed.json");

/**
 * Fixture HTML with distinct, text-identifiable elements. Plain inline styles
 * (no CDN) so the layout is deterministic and offline. The flex row of two
 * buttons exercises reorder/move; headings and paragraphs exercise select.
 */
export const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>E2E Fixture</title>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f1115;color:#f4f4f5">
    <main style="max-width:720px;margin:0 auto;padding:48px 32px;display:flex;flex-direction:column;gap:24px">
      <h1 style="font-size:40px;font-weight:800;margin:0">E2E Hero Heading</h1>
      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">First fixture paragraph for selection tests.</p>
      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>
      <div style="display:flex;flex-direction:row;gap:16px">
        <button style="padding:14px 28px;border-radius:10px;border:0;background:#6366f1;color:#fff;font-size:16px">Alpha Button</button>
        <button style="padding:14px 28px;border-radius:10px;border:0;background:#22c55e;color:#06240f;font-size:16px">Beta Button</button>
      </div>
      <section style="margin-top:16px;padding:24px;border-radius:14px;background:#1a1d24">
        <h2 style="font-size:24px;margin:0 0 8px">Fixture Card Title</h2>
        <p style="margin:0;color:#a1a1aa">Card body text inside a nested container.</p>
      </section>
    </main>
  </body>
</html>`;

async function postAction(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const res = await request.post(`${baseURL}/_agent-native/actions/${name}`, {
    data: input,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(
      `action ${name} failed: ${res.status()} ${await res.text()}`,
    );
  }
  return res.json();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
  await mkdir(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded" });

    const isSignIn = async () => /sign in/i.test(await page.title());

    if (await isSignIn()) {
      // Try to create the account; if it already exists, fall back to sign in.
      await page.getByRole("textbox", { name: "Email" }).fill(E2E_EMAIL);
      await page
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(E2E_PASSWORD);
      const confirm = page.getByRole("textbox", { name: "Confirm password" });
      if (await confirm.count()) await confirm.fill(E2E_PASSWORD);
      await page
        .locator("#signup-form")
        .getByRole("button", { name: "Create account" })
        .click()
        .catch(() => {});
      await page.waitForTimeout(2500);

      if (await isSignIn()) {
        // Account exists; switch to the Sign in tab and log in.
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .first()
          .click()
          .catch(() => {});
        await page.getByRole("textbox", { name: "Email" }).fill(E2E_EMAIL);
        await page
          .getByRole("textbox", { name: "Password", exact: true })
          .fill(E2E_PASSWORD);
        await page
          .getByRole("button", { name: /sign in/i })
          .last()
          .click()
          .catch(() => {});
        await page.waitForTimeout(2500);
      }
    }

    await page
      .waitForFunction(() => !/sign in/i.test(document.title), null, {
        timeout: 20_000,
      })
      .catch(() => {});

    await context.storageState({ path: STATE_PATH });

    // Seed a design + fixture file via the authenticated action surface.
    const created = await postAction(
      context.request,
      baseURL,
      "create-design",
      {
        title: SEED_TITLE,
        projectType: "prototype",
      },
    );
    const designId: string =
      created?.id ?? created?.data?.id ?? created?.design?.id;
    if (!designId) {
      throw new Error(
        `create-design did not return an id: ${JSON.stringify(created)}`,
      );
    }
    await postAction(context.request, baseURL, "create-file", {
      designId,
      filename: "index.html",
      content: FIXTURE_HTML,
      fileType: "html",
    });

    await writeFile(SEED_PATH, JSON.stringify({ designId }, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[e2e] seeded design ${designId} for ${E2E_EMAIL}`);
  } finally {
    await browser.close();
  }
}

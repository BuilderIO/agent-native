import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@libsql/client";
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

const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(import.meta.dirname, ".auth");
const STATE_PATH = path.join(AUTH_DIR, "state.json");
const SEED_PATH = path.join(AUTH_DIR, "seed.json");
const BROWSER_CHANNEL = process.env.E2E_BROWSER_CHANNEL;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `file:${path.join(import.meta.dirname, "..", "data", "e2e.db")}`;

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
    <style>
      :root {
        --e2e-accent-color: #6366f1;
        --e2e-radius: 14px;
      }
    </style>
  </head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#0f1115;color:#f4f4f5">
    <main style="max-width:720px;margin:0 auto;padding:48px 32px;display:flex;flex-direction:column;gap:24px">
      <h1 style="font-size:40px;font-weight:800;margin:0;color:#f4f4f5">E2E Hero Heading</h1>
      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">First fixture paragraph for selection tests.</p>
      <p style="font-size:18px;line-height:1.6;margin:0;color:#a1a1aa">Second fixture paragraph for selection tests.</p>
      <div style="display:flex;flex-direction:row;gap:16px">
        <button data-agent-native-node-id="e2e-alpha-button" data-agent-native-layer-name="Alpha Button" style="padding:14px 28px;border-radius:10px;border:0;background:#6366f1;color:#fff;font-size:16px">Alpha Button</button>
        <button data-agent-native-node-id="e2e-beta-button" data-agent-native-layer-name="Beta Button" style="padding:14px 28px;border-radius:10px;border:0;background:#22c55e;color:#06240f;font-size:16px">Beta Button</button>
      </div>
      <button
        data-agent-native-node-id="e2e-component-button"
        data-agent-native-layer-name="E2E Component Button"
        data-agent-native-component="E2EButton"
        data-agent-native-prop-variant="primary"
        data-agent-native-prop-size="md"
        style="align-self:flex-start;padding:14px 28px;border-radius:var(--e2e-radius);border:0;background:var(--e2e-accent-color);color:#fff;font-size:16px"
      >Variant CTA</button>
      <div
        data-agent-native-node-id="e2e-token-sample"
        data-agent-native-layer-name="E2E Token Sample"
        style="padding:18px 20px;border-radius:var(--e2e-radius);background:var(--e2e-accent-color);color:#fff;font-weight:700"
      >Token swatch sample</div>
      <div style="display:flex;align-items:center;gap:12px">
        <img data-agent-native-node-id="e2e-audit-image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:32px;height:32px;border-radius:8px;background:#27272a" />
        <input data-agent-native-node-id="e2e-audit-input" placeholder="Email" style="height:32px;border-radius:8px;border:1px solid #3f3f46;background:#18181b;color:#fff;padding:0 10px" />
        <button data-agent-native-node-id="e2e-audit-focus-button" class="outline-none" style="height:32px;border-radius:8px;border:1px solid #3f3f46;background:#27272a;color:#fff;padding:0 10px">Focus me</button>
      </div>
      <div style="padding:8px;border:1px solid #27272a;border-radius:12px">
        <div style="padding:8px;border:1px solid #3f3f46;border-radius:10px">
          <div style="padding:8px;border:1px solid #52525b;border-radius:8px">
            <div style="padding:8px;border:1px solid #71717a;border-radius:6px">
              <button style="padding:10px 18px;border-radius:8px;border:0;background:#f59e0b;color:#111827;font-size:14px">Deep Layer Button</button>
            </div>
          </div>
        </div>
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

function componentIndexId(designId: string, name: string): string {
  return `ci_${designId}_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}

export async function seedComponentVariantMetadata(
  designId: string,
): Promise<void> {
  const client = createClient({ url: E2E_DATABASE_URL });
  const name = "E2EButton";
  const now = new Date().toISOString();
  const variants = JSON.stringify({
    variant: ["primary", "secondary", "ghost"],
    size: ["sm", "md", "lg"],
  });
  const props = JSON.stringify([
    { name: "variant", type: "primary | secondary | ghost" },
    { name: "size", type: "sm | md | lg" },
  ]);

  try {
    const result = await client.execute({
      sql: `
        UPDATE component_index
        SET variants = ?, props = ?, file_path = ?, export_name = ?, updated_at = ?
        WHERE design_id = ? AND name = ?
      `,
      args: [variants, props, "index.html", name, now, designId, name],
    });

    if (result.rowsAffected > 0) return;

    await client.execute({
      sql: `
        INSERT INTO component_index (
          id, design_id, name, file_path, export_name, props, variants,
          runtime_selectors, owner_email, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        componentIndexId(designId, name),
        designId,
        name,
        "index.html",
        name,
        props,
        variants,
        JSON.stringify(['[data-agent-native-node-id="e2e-component-button"]']),
        E2E_EMAIL,
        now,
        now,
      ],
    });
  } finally {
    client.close();
  }
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
  await mkdir(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch(
    BROWSER_CHANNEL ? { channel: BROWSER_CHANNEL } : {},
  );
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseURL}/_agent-native/sign-in`, {
      waitUntil: "domcontentloaded",
    });

    const isSignIn = async () => /sign in/i.test(await page.title());

    if (await isSignIn()) {
      // Try to create the account; if it already exists, fall back to sign in.
      await page.locator("#s-email").fill(E2E_EMAIL);
      await page.locator("#s-pass").fill(E2E_PASSWORD);
      await page.locator("#s-pass2").fill(E2E_PASSWORD);
      await page.locator("#signup-form button[type='submit']").click();
      await page.waitForTimeout(2500);

      if (await isSignIn()) {
        // Account exists; switch to the Sign in tab and log in.
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .first()
          .click()
          .catch(() => {});
        await page.locator("#l-email").fill(E2E_EMAIL);
        await page.locator("#l-pass").fill(E2E_PASSWORD);
        await page.locator("#login-form button[type='submit']").click();
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
    await postAction(context.request, baseURL, "index-components", {
      designId,
    });
    await seedComponentVariantMetadata(designId);

    await writeFile(SEED_PATH, JSON.stringify({ designId }, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[e2e] seeded design ${designId} for ${E2E_EMAIL}`);
  } finally {
    await browser.close();
  }
}

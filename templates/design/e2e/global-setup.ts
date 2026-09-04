import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

import { e2eBaseURL } from "./base-url";

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

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ?? e2eBaseURL();
  await mkdir(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch(
    BROWSER_CHANNEL ? { channel: BROWSER_CHANNEL } : {},
  );
  const context = await browser.newContext();

  try {
    const registration = await context.request.post(
      `${baseURL}/_agent-native/auth/register`,
      {
        data: {
          email: E2E_EMAIL,
          password: E2E_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!registration.ok() && registration.status() !== 409) {
      throw new Error(
        `registration failed: ${registration.status()} ${await registration.text()}`,
      );
    }

    const login = await context.request.post(
      `${baseURL}/_agent-native/auth/login`,
      {
        data: {
          email: E2E_EMAIL,
          password: E2E_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!login.ok()) {
      throw new Error(`login failed: ${login.status()} ${await login.text()}`);
    }

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

    await writeFile(SEED_PATH, JSON.stringify({ designId }, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[e2e] seeded design ${designId} for ${E2E_EMAIL}`);

    // Compile the editor once, here, instead of inside the first test's 30s
    // budget. DesignEditor.tsx is past Babel's 500KB deopt threshold, so a
    // cold dev server can take ~40s to first paint — which is why the first
    // spec in a shard was the one that flaked.
    const warmupPage = await context.newPage();
    try {
      await warmupPage.goto(`${baseURL}/design/${designId}`, {
        waitUntil: "domcontentloaded",
      });
      await warmupPage
        .getByRole("button", { name: "Move", exact: true })
        .waitFor({ timeout: 180_000 });
      // eslint-disable-next-line no-console
      console.log("[e2e] editor warm");
    } catch (error) {
      // Not fatal — the suite still runs, the first test just pays the
      // compile again. Say so out loud rather than reporting a warm editor.
      // eslint-disable-next-line no-console
      console.warn(
        `[e2e] editor warmup did not finish (${(error as Error).message.split("\n")[0]}); ` +
          "the first test will pay the compile.",
      );
    } finally {
      await warmupPage.close();
    }
  } finally {
    await browser.close();
  }
}

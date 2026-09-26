import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { createDbExec } from "@agent-native/core/db";
import { chromium, type FullConfig } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { designE2eRunRoot } from "./global-teardown";


export const E2E_EMAIL = "e2e+autoz@local.test";
export const E2E_MENTION_EMAIL = "alice+e2e@local.test";
export const E2E_PASSWORD = "password-e2e-1234";
export const SEED_TITLE = "E2E Seed Design";

const AUTH_DIR = process.env.E2E_AUTH_DIR
  ? path.resolve(process.env.E2E_AUTH_DIR)
  : path.join(
      process.env.E2E_RUN_ROOT ??
        path.join(import.meta.dirname, "..", "..", ".tmp", "design-e2e"),
      "auth",
    );
const STATE_PATH = path.join(AUTH_DIR, "state.json");
const SEED_PATH = path.join(AUTH_DIR, "seed.json");
const BROWSER_CHANNEL = process.env.E2E_BROWSER_CHANNEL;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `pglite:${path.join(import.meta.dirname, "..", "data", "e2e-pglite")}`;
const LOOPBACK_READINESS_TIMEOUT_MS = 10_000;
const LOOPBACK_READINESS_RETRY_MS = 50;

async function startLoopbackProvider(port: number): Promise<void> {
  const runRoot = designE2eRunRoot(path.resolve(import.meta.dirname, ".."));
  if (!runRoot) throw new Error("loopback provider requires an E2E run root");
  const loopbackPidPath = path.join(runRoot, "loopback-provider.pid");
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx/esm",
      path.join(import.meta.dirname, "loopback-design-provider.ts"),
    ],
    {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        E2E_LOOPBACK_PORT: String(port),
      },
    },
  );
  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });
  if (!child.pid) throw new Error("loopback provider did not start");
  await mkdir(path.dirname(loopbackPidPath), { recursive: true });
  await writeFile(loopbackPidPath, String(child.pid));
  const deadline = Date.now() + LOOPBACK_READINESS_TIMEOUT_MS;
  let lastError: unknown;
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      try {
        const response = await fetch(
          `http://127.0.0.1:${port}/v1/models` /* e2e-harness-ignore: allocated provider port, not Design base URL */,
          {
            signal: AbortSignal.timeout(250),
          },
        );
        if (response.ok) {
          child.unref();
          return;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, LOOPBACK_READINESS_RETRY_MS),
      );
    }
    const detail =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `loopback provider did not become ready on port ${port}: ${detail}`,
    );
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await rm(loopbackPidPath, { force: true });
    throw error;
  }
}

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
              <button data-agent-native-node-id="e2e-deep-layer-button" data-agent-native-layer-name="Deep Layer Button" style="padding:10px 18px;border-radius:8px;border:0;background:#f59e0b;color:#111827;font-size:14px">Deep Layer Button</button>
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
  const client = await createDbExec({ url: E2E_DATABASE_URL });
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
    await client.close?.();
  }
}

async function seedMentionMember(
  browser: import("@playwright/test").Browser,
  ownerContext: import("@playwright/test").BrowserContext,
  baseURL: string,
): Promise<void> {
  const memberSearch = encodeURIComponent(E2E_MENTION_EMAIL);
  const membersURL = `${baseURL}/_agent-native/org/members?limit=25&offset=0&search=${memberSearch}`;
  const existingMembers = await ownerContext.request.get(membersURL);
  if (!existingMembers.ok()) {
    const body = await existingMembers.text();
    if (
      existingMembers.status() === 400 &&
      body.includes("You must belong to an organization")
    ) {
      return;
    }
    throw new Error(
      `list organization members failed: ${existingMembers.status()} ${body}`,
    );
  }
  const existingPayload = await existingMembers.json();
  if (
    Array.isArray(existingPayload?.members) &&
    existingPayload.members.some(
      (member: { email?: unknown }) =>
        String(member.email ?? "").toLowerCase() === E2E_MENTION_EMAIL,
    )
  ) {
    return;
  }

  const invitation = await ownerContext.request.post(
    `${baseURL}/_agent-native/org/invitations`,
    {
      data: { email: E2E_MENTION_EMAIL, role: "member" },
      headers: { "Content-Type": "application/json" },
    },
  );
  let invitationId: string | undefined;
  if (invitation.ok()) {
    invitationId = String((await invitation.json())?.id ?? "") || undefined;
  } else {
    const body = await invitation.text();
    if (
      invitation.status() === 400 &&
      body.includes("You must belong to an organization")
    ) {
      return;
    }
    if (invitation.status() !== 409) {
      throw new Error(
        `invite mention member failed: ${invitation.status()} ${body}`,
      );
    }
  }

  if (!invitationId) {
    const pending = await ownerContext.request.get(
      `${baseURL}/_agent-native/org/invitations`,
    );
    if (!pending.ok()) {
      throw new Error(
        `list pending invitations failed: ${pending.status()} ${await pending.text()}`,
      );
    }
    const pendingPayload = await pending.json();
    invitationId =
      String(
        pendingPayload?.invitations?.find(
          (item: { email?: unknown }) =>
            String(item.email ?? "").toLowerCase() === E2E_MENTION_EMAIL,
        )?.id ?? "",
      ) || undefined;
  }

  const memberContext = await browser.newContext();
  try {
    const registration = await memberContext.request.post(
      `${baseURL}/_agent-native/auth/register`,
      {
        data: {
          email: E2E_MENTION_EMAIL,
          password: E2E_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!registration.ok() && registration.status() !== 409) {
      throw new Error(
        `mention member registration failed: ${registration.status()} ${await registration.text()}`,
      );
    }

    const login = await memberContext.request.post(
      `${baseURL}/_agent-native/auth/login`,
      {
        data: {
          email: E2E_MENTION_EMAIL,
          password: E2E_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!login.ok()) {
      throw new Error(
        `mention member login failed: ${login.status()} ${await login.text()}`,
      );
    }

    if (invitationId) {
      const acceptance = await memberContext.request.post(
        `${baseURL}/_agent-native/org/invitations/${encodeURIComponent(invitationId)}/accept`,
        {
          data: {},
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!acceptance.ok() && acceptance.status() !== 404) {
        throw new Error(
          `accept mention member invitation failed: ${acceptance.status()} ${await acceptance.text()}`,
        );
      }
    }
  } finally {
    await memberContext.close();
  }

  const members = await ownerContext.request.get(membersURL);
  if (!members.ok()) {
    throw new Error(
      `verify mention member failed: ${members.status()} ${await members.text()}`,
    );
  }
  const payload = await members.json();
  if (
    !Array.isArray(payload?.members) ||
    !payload.members.some(
      (member: { email?: unknown }) =>
        String(member.email ?? "").toLowerCase() === E2E_MENTION_EMAIL,
    )
  ) {
    throw new Error(`mention member ${E2E_MENTION_EMAIL} was not provisioned`);
  }
}

export default async function globalSetup(config: FullConfig) {
  if (process.env.E2E_AI_SIDEBAR_LOOPBACK === "1")
    await startLoopbackProvider(config.metadata.sidebarLoopbackPort as number);
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
    await seedMentionMember(browser, context, baseURL);
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

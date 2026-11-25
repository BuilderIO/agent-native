import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

type Step =
  | { goto: string }
  | { click: string }
  | { press: string }
  | { reload: true }
  | { freshSignIn: true }
  | { expectUrl: string }
  | { fill: string; value: string }
  | { expectText: string }
  | { expectVisible: string }
  | { expectAttr: string; attr: string; value: string }
  | { expectValue: string; value: string }
  | { action: string; input?: Record<string, unknown>; as?: string }
  | { screenshot: string };

interface Target {
  app: string;
  ref?: string;
  path?: string;
  write?: "forms" | "app-state";
  steps?: Step[];
  verify?: Step[];
  cleanup?: { action: string; input?: Record<string, unknown> }[];
}

interface StepResult {
  step: string;
  ok: boolean;
  ms: number;
  error?: string;
}

const PRESETS: Record<string, Target> = {
  "forms-seeded": {
    app: "forms-2",
    write: "forms",
    steps: [
      { expectText: "My workspace" },
      { expectText: "Start from a template" },
    ],
    verify: [
      { click: "text=${write.key}" },
      { expectUrl: "/forms/${write.id}" },
      { reload: true },
      { expectUrl: "/forms/${write.id}" },
      {
        expectValue: 'input[data-editable="form-title"]',
        value: "${write.key}",
      },
      { screenshot: "editor-after-reload" },
      { freshSignIn: true },
      { expectText: "${write.key}" },
    ],
  },
};

function parseTarget(raw: string): Target {
  const text = raw.trim();
  if (Object.hasOwn(PRESETS, text)) return PRESETS[text];
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text) as Target;
    if (!parsed.app) throw new Error("target JSON needs an app");
    return parsed;
  }
  if (/^[a-z0-9-]+$/.test(text)) return { app: text };
  throw new Error(`target must be a preset, an app name, or JSON: ${text}`);
}

const target = parseTarget(process.env.QA_TARGET ?? "forms-seeded");
const provider = (process.env.QA_PROVIDER?.trim() || "browserbase") as
  | "browserbase"
  | "local";
const slot = process.env.QA_SLOT?.trim() || "1";
const host = (process.env.QA_HOST?.trim() || "labs.agent-native.com").replace(
  /^https?:\/\//,
  "",
);
const origin = `https://${host}`;
const appBase = `${origin}/${target.app}`;
const ref = target.ref || process.env.QA_REF?.trim() || target.app;
const outDir = path.resolve(
  process.env.QA_OUT_DIR?.trim() || "artifacts/qa-live-verify",
);
mkdirSync(outDir, { recursive: true });

const { ensureUser, qaIdentity } = await import("./labs-qa-users.ts");

const BB_API = "https://api.browserbase.com/v1";

interface BrowserbaseSession {
  id: string;
  connectUrl?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
}

async function bb<T>(method: string, url: string, body?: unknown): Promise<T> {
  const key = process.env.BROWSERBASE_API_KEY?.trim();
  if (!key)
    throw new Error("BROWSERBASE_API_KEY is required for provider=browserbase");
  const res = await fetch(`${BB_API}${url}`, {
    method,
    headers: { "X-BB-API-Key": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `Browserbase ${method} ${url}: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  return JSON.parse(text) as T;
}

async function settledSession(id: string): Promise<BrowserbaseSession> {
  let last = await bb<BrowserbaseSession>("GET", `/sessions/${id}`);
  for (let i = 0; i < 20 && last.status === "RUNNING"; i++) {
    // fixed-sleep-ok: Browserbase has no push signal for session end, so poll its status
    await new Promise((r) => setTimeout(r, 1500));
    last = await bb<BrowserbaseSession>("GET", `/sessions/${id}`);
  }
  return last;
}

async function servedSha(): Promise<string | null> {
  for (const url of [`${appBase}/_agent-native/health`, `${appBase}/`]) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const sha = res.headers.get("x-agent-native-build-sha");
    if (sha) return sha;
  }
  return null;
}

async function inPage<T>(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
) {
  return page.evaluate(
    async ({ method, url, body }) => {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, json, text: text.slice(0, 300) };
    },
    { method, url, body },
  ) as Promise<{ status: number; json: T | null; text: string }>;
}

async function callAction<T = Record<string, unknown>>(
  page: Page,
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const r = await inPage<T>(
    page,
    "POST",
    `${appBase}/_agent-native/actions/${name}`,
    input,
  );
  if (r.status !== 200 || !r.json)
    throw new Error(`action ${name}: HTTP ${r.status} ${r.text}`);
  return r.json;
}

const vars: Record<string, unknown> = {};
function interpolate<T>(value: T): T {
  const text = JSON.stringify(value).replace(
    /\$\{([\w.]+)\}/g,
    (_, key: string) => {
      const resolved = key
        .split(".")
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
          vars,
        );
      if (resolved === undefined) throw new Error(`unresolved \${${key}}`);
      return String(resolved);
    },
  );
  return JSON.parse(text) as T;
}

const shots: string[] = [];
async function shot(page: Page, name: string) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(path.basename(file));
}

async function signInThroughUi(page: Page, email: string, password: string) {
  await page.goto(`${appBase}/`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const emailInput = page.locator('input[type="email"]:visible').first();
  await emailInput.waitFor({ timeout: 30_000 });
  await emailInput.fill(email);
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await page
    .locator('input[placeholder="Enter password"]:visible')
    .fill(password);
  await page.locator('input[type="email"]:visible').first().fill(email);
  await page
    .locator('button[type="submit"]:visible', { hasText: /^Sign in$/ })
    .click();
  await page.waitForURL((url) => !url.pathname.includes("/sign-in"), {
    timeout: 45_000,
  });
  const session = await inPage<{ email?: string }>(
    page,
    "GET",
    `${appBase}/_agent-native/auth/session`,
  );
  if (session.json?.email?.toLowerCase() !== email) {
    throw new Error(
      `signed-in session is not the QA user (HTTP ${session.status})`,
    );
  }
}

let credentials: { email: string; password: string } | undefined;

async function runStep(page: Page, step: Step) {
  const s = interpolate(step);
  if ("goto" in s) {
    await page.goto(
      `${appBase}${s.goto.startsWith("/") ? s.goto : `/${s.goto}`}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      },
    );
  } else if ("click" in s)
    await page.locator(s.click).first().click({ timeout: 20_000 });
  else if ("press" in s) await page.keyboard.press(s.press);
  else if ("freshSignIn" in s) {
    if (!credentials) throw new Error("no QA credentials for a fresh sign-in");
    await page.context().clearCookies();
    await signInThroughUi(page, credentials.email, credentials.password);
  } else if ("reload" in s)
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  else if ("expectUrl" in s)
    await page.waitForURL((url) => url.href.includes(s.expectUrl), {
      timeout: 20_000,
    });
  else if ("fill" in s)
    await page.locator(s.fill).first().fill(s.value, { timeout: 20_000 });
  else if ("expectText" in s)
    await page
      .getByText(s.expectText)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
  else if ("expectVisible" in s)
    await page
      .locator(s.expectVisible)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
  else if ("expectValue" in s) {
    const actual = await page
      .locator(s.expectValue)
      .first()
      .inputValue({ timeout: 20_000 });
    if (actual !== s.value)
      throw new Error(
        `value=${JSON.stringify(actual)}, want ${JSON.stringify(s.value)}`,
      );
  } else if ("expectAttr" in s) {
    const loc = page.locator(s.expectAttr).first();
    await loc.waitFor({ timeout: 20_000 });
    const actual = await loc.getAttribute(s.attr);
    if (actual !== s.value)
      throw new Error(
        `${s.attr}=${JSON.stringify(actual)}, want ${JSON.stringify(s.value)}`,
      );
  } else if ("action" in s) {
    const out = await callAction(page, s.action, s.input);
    if (s.as) vars[s.as] = out;
  } else if ("screenshot" in s) await shot(page, s.screenshot);
}

interface Readback {
  kind: string;
  key: string;
  id: string;
  apiAfterReload: boolean;
  uiAfterReload: boolean | null;
}

async function savedOnServer(page: Page, id: string, text: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const r = await inPage(
      page,
      "GET",
      `${appBase}/_agent-native/actions/get-form?id=${encodeURIComponent(id)}`,
    );
    if (r.status === 200 && JSON.stringify(r.json).includes(text)) return;
    if (Date.now() > deadline)
      throw new Error(`form ${id} never saved "${text}" (HTTP ${r.status})`);
    // fixed-sleep-ok: the editor autosaves on a debounce with no completion event, so poll the server copy
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

async function writeAndReadBack(
  page: Page,
): Promise<{ readback: Readback; cleanup: () => Promise<void> }> {
  const name = `qa-tmp-live-${ref.replace(/[^a-z0-9-]/gi, "")}-${Date.now()}`;
  if (
    (target.write ?? (target.app === "forms-2" ? "forms" : "app-state")) ===
    "forms"
  ) {
    await page.goto(`${appBase}/`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .getByRole("button", { name: "New form", exact: true })
      .first()
      .click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/, { timeout: 30_000 });
    const id = decodeURIComponent(
      page.url().match(/\/forms\/([^/]+)\/edit/)?.[1] ?? "",
    );
    if (!id) throw new Error(`no form id in ${page.url()}`);
    const cleanup = async () => {
      await callAction(page, "delete-form", { id });
    };
    const title = page.locator('input[data-editable="form-title"]');
    await title.click();
    await page.keyboard.type(name);
    await savedOnServer(page, id, name);
    await page.goto(`${appBase}/`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    const ui = await page
      .getByText(name)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(
        () => true,
        () => false,
      );
    const read = await inPage<{ id?: string }>(
      page,
      "GET",
      `${appBase}/_agent-native/actions/get-form?id=${encodeURIComponent(id)}`,
    );
    return {
      readback: {
        kind: "forms:new-form-ui",
        key: name,
        id,
        apiAfterReload:
          read.status === 200 && read.json?.id === id && read.text.length > 0,
        uiAfterReload: ui,
      },
      cleanup,
    };
  }
  const url = `${appBase}/_agent-native/application-state/${name}`;
  const put = await inPage(page, "PUT", url, { value: name });
  if (put.status !== 200)
    throw new Error(`application-state write: HTTP ${put.status} ${put.text}`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  const read = await inPage<{ value?: string }>(page, "GET", url);
  return {
    readback: {
      kind: "application-state",
      key: name,
      id: name,
      apiAfterReload: read.status === 200 && read.json?.value === name,
      uiAfterReload: null,
    },
    cleanup: async () => {
      const del = await inPage(page, "DELETE", url);
      if (del.status !== 200)
        throw new Error(`application-state cleanup: HTTP ${del.status}`);
    },
  };
}

async function main() {
  const started = Date.now();
  const steps: StepResult[] = [];
  const receipt: Record<string, unknown> = {
    ref,
    target,
    provider,
    host,
    app: target.app,
    qaUser: `qa-fleet-${slot}`,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    servedSha: await servedSha(),
  };

  let browser: Browser | undefined;
  let sessionId: string | undefined;
  let failure: string | undefined;
  const cleanups: (() => Promise<void>)[] = [];
  try {
    await ensureUser(slot);
    const { email, password } = qaIdentity(slot);
    credentials = { email, password };

    if (provider === "browserbase") {
      const session = await bb<BrowserbaseSession>("POST", "/sessions", {});
      sessionId = session.id;
      console.log(`BB-SESSION-START: ${session.id}`);
      if (!session.connectUrl)
        throw new Error("Browserbase session has no connectUrl");
      browser = await chromium.connectOverCDP(session.connectUrl);
    } else {
      browser = await chromium.launch({ headless: true });
    }
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1280, height: 800 });

    const timed = async (label: string, fn: () => Promise<void>) => {
      const t = Date.now();
      try {
        await fn();
        steps.push({ step: label, ok: true, ms: Date.now() - t });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message.split("\n")[0] : String(err);
        steps.push({ step: label, ok: false, ms: Date.now() - t, error: msg });
        throw new Error(`${label}: ${msg}`);
      }
    };

    await timed("sign-in (browser UI)", () =>
      signInThroughUi(page, email, password),
    );
    await timed("open app", async () => {
      await page.goto(`${appBase}${target.path ?? "/"}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 20_000 })
        .catch(() => undefined);
    });
    await shot(page, "before");
    for (const [i, step] of (target.steps ?? []).entries()) {
      await timed(`step ${i + 1} ${JSON.stringify(step).slice(0, 120)}`, () =>
        runStep(page, step),
      );
    }
    let readback: Readback | undefined;
    await timed("qa-tmp write + reload + read back", async () => {
      const result = await writeAndReadBack(page);
      cleanups.push(result.cleanup);
      readback = result.readback;
      if (!readback.apiAfterReload || readback.uiAfterReload === false) {
        throw new Error(`read back failed ${JSON.stringify(readback)}`);
      }
    });
    receipt.readback = readback;
    await shot(page, "after");
    vars.write = readback;
    for (const [i, step] of (target.verify ?? []).entries()) {
      await timed(`verify ${i + 1} ${JSON.stringify(step).slice(0, 120)}`, () =>
        runStep(page, step),
      );
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    const cleaned: string[] = [];
    for (const fn of [
      ...cleanups,
      ...(target.cleanup ?? []).map((c) => () => {
        const page = browser?.contexts()[0]?.pages()[0];
        if (!page) return Promise.reject(new Error("no page for cleanup"));
        return callAction(page, c.action, interpolate(c.input ?? {})).then(
          () => undefined,
        );
      }),
    ]) {
      try {
        await fn();
        cleaned.push("ok");
      } catch (err) {
        cleaned.push(
          `failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    receipt.cleanup = cleaned;
    await browser?.close().catch(() => undefined);
  }

  if (sessionId) {
    const s = await settledSession(sessionId);
    const durationSec =
      s.startedAt && s.endedAt
        ? Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)
        : null;
    receipt.browserbase = {
      sessionId,
      status: s.status,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSec,
      replayUrl: `https://www.browserbase.com/sessions/${sessionId}`,
    };
    console.log(
      `BB-SESSION: ${sessionId} ${durationSec}s ${s.status} https://www.browserbase.com/sessions/${sessionId}`,
    );
  }

  const cleanFailed = (receipt.cleanup as string[]).some((c) => c !== "ok");
  receipt.steps = steps;
  receipt.screenshots = shots;
  receipt.wallSec = Math.round((Date.now() - started) / 1000);
  receipt.result = failure || cleanFailed ? "FAIL" : "PASS";
  if (failure) receipt.error = failure;
  writeFileSync(
    path.join(outDir, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  console.log(
    `QA-LIVE: ${receipt.result} ${ref} sha=${receipt.servedSha}${failure ? ` ${failure}` : ""}`,
  );
  if (receipt.result !== "PASS") process.exit(1);
}

await main();

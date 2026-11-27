import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium, type Browser, type Page } from "@playwright/test";

import { waitForVerificationEmail } from "../signup/lib/mailosaur.ts";
import {
  readQaBuildEvidence,
  type QaBuildWitness,
} from "./qa-build-evidence.ts";
import { readCalendarSettingsFocus } from "./qa-calendar-focus.ts";
import { LABS_QA_ORIGIN, labsQaEmailLink } from "./qa-email-link.ts";
import {
  assertReadOnlyQaTarget,
  allowsReadOnlyQaRequest,
} from "./qa-read-only.ts";

type Step =
  | { goto: string }
  | { click: string }
  | { press: string }
  | { reload: true }
  | { freshSignIn: true }
  | { ifVisible: string; then: Step[] }
  | { expectUrl: string }
  | { fill: string; value: string }
  | { expectText: string }
  | { expectVisible: string }
  | { expectAttr: string; attr: string; value: string }
  | { expectValue: string; value: string }
  | {
      action: string;
      input?: Record<string, unknown>;
      as?: string;
      method?: "GET" | "POST";
      expect?: Record<string, string | number | boolean>;
    }
  | { screenshot: string };

interface Target {
  app: string;
  ref?: string;
  path?: string;
  write?: "forms" | "app-state" | "none";
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
const authMethod = process.env.QA_VERIFY_AUTH?.trim() || "legacy-password";
if (!["legacy-password", "qa-email-link"].includes(authMethod)) {
  throw new Error("Unsupported QA verify authentication mode");
}
const emailLinkMode = authMethod === "qa-email-link";
const readOnlyMode = target.write === "none";
if (readOnlyMode) assertReadOnlyQaTarget(target, emailLinkMode);
const origin = `https://${host}`;
if (
  emailLinkMode &&
  (origin !== LABS_QA_ORIGIN ||
    !/^[1-5]$/.test(slot) ||
    !/^[a-z0-9-]+$/.test(target.app))
) {
  throw new Error(
    "QA email-link verification requires Labs and an approved QA user slot",
  );
}
const appBase = `${origin}/${target.app}`;
const ref = target.ref || process.env.QA_REF?.trim() || target.app;
const outDir = path.resolve(
  process.env.QA_OUT_DIR?.trim() || "artifacts/qa-live-verify",
);
mkdirSync(outDir, { recursive: true });

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
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const url = `${appBase}/_agent-native/actions/${name}`;
  const r =
    method === "GET"
      ? await inPage<T>(
          page,
          "GET",
          `${url}?${new URLSearchParams(
            Object.entries(input).map(([k, v]) => [k, String(v)]),
          )}`,
        )
      : await inPage<T>(page, "POST", url, input);
  if (r.status !== 200 || !r.json)
    throw new Error(`action ${name}: HTTP ${r.status} ${r.text}`);
  return r.json;
}

const vars: Record<string, unknown> = {};
const actionReadbacks: { action: string; path: string; got: unknown }[] = [];
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
  await assertQaIdentity(page, email);
}

async function assertQaIdentity(page: Page, email: string) {
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

const usedMessages = new Set<string>();
function qaSlotEmail(): string {
  const serverId = process.env.MAILOSAUR_SERVER_ID?.trim();
  if (!serverId || !/^[a-z0-9][a-z0-9-]{1,62}$/i.test(serverId)) {
    throw new Error("QA mailbox server is unavailable");
  }
  return `qa-fleet-${slot}@${serverId}.mailosaur.net`.toLowerCase();
}

async function signInWithQaEmailLink(page: Page) {
  const email = qaSlotEmail();
  let stage = "open the sign-in form";
  try {
    await page.goto(`${appBase}/sign-in`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (new URL(page.url()).origin !== origin)
      throw new Error("unexpected sign-in origin");
    await page
      .locator("#magic-link-form")
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#m-email").fill(email);
    const requestedAt = Date.now();
    await page.locator("#magic-link-submit").click();
    await page
      .locator("#magic-link-success")
      .waitFor({ state: "visible", timeout: 30_000 });
    stage = "receive the QA email";
    const message = await waitForVerificationEmail(
      email,
      requestedAt,
      usedMessages,
    );
    usedMessages.add(message.id);
    const link = labsQaEmailLink(message, target.app, email, requestedAt);
    stage = "redeem the QA email link";
    const response = await page.goto(link.href, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    if (!response?.ok() || new URL(page.url()).origin !== origin)
      throw new Error("QA email-link landing refused");
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(
      (url) =>
        url.origin === origin &&
        !url.pathname.includes("/_agent-native/auth/") &&
        !url.pathname.includes("/sign-in"),
      { timeout: 30_000 },
    );
    stage = "verify the QA browser identity";
    await assertQaIdentity(page, email);
  } catch {
    throw new Error("QA email-link verification could not " + stage);
  }
}

let repeatSignIn: ((page: Page) => Promise<void>) | undefined;

async function legacySignIn(): Promise<(page: Page) => Promise<void>> {
  const { ensureUser, qaIdentity } = await import("./labs-qa-users.ts");
  await ensureUser(slot);
  const { email, password } = qaIdentity(slot);
  return (page) => signInThroughUi(page, email, password);
}

async function runStep(page: Page, step: Step): Promise<void> {
  if ("ifVisible" in step) {
    const shown = await page
      .locator(interpolate(step.ifVisible))
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(
        () => true,
        () => false,
      );
    if (shown) for (const inner of step.then) await runStep(page, inner);
    return;
  }
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
    if (!repeatSignIn) throw new Error("QA sign-in is unavailable");
    await page.context().clearCookies();
    await repeatSignIn(page);
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
    const out = await callAction(page, s.action, s.input, s.method);
    if (s.as) vars[s.as] = out;
    for (const [dotted, want] of Object.entries(s.expect ?? {})) {
      const got = dotted
        .split(".")
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
          out,
        );
      actionReadbacks.push({ action: s.action, path: dotted, got });
      if (got !== want)
        throw new Error(
          `${s.action} ${dotted}=${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
        );
    }
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
    authMethod,
    host,
    app: target.app,
    qaUser: `qa-fleet-${slot}`,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    servedSha: await servedSha(),
  };

  let browser: Browser | undefined;
  const buildEvidence: {
    before: QaBuildWitness | null;
    after: QaBuildWitness | null;
  } = {
    before: null,
    after: null,
  };
  let activePage: Page | undefined;
  let sessionId: string | undefined;
  let failure: string | undefined;
  let identityVerified = false;
  const cleanups: (() => Promise<void>)[] = [];
  try {
    const signIn = emailLinkMode ? signInWithQaEmailLink : await legacySignIn();
    repeatSignIn = signIn;

    if (provider === "browserbase") {
      const session = await bb<BrowserbaseSession>(
        "POST",
        "/sessions",
        emailLinkMode
          ? { browserSettings: { recordSession: false, logSession: false } }
          : {},
      );
      sessionId = session.id;
      console.log(`BB-SESSION-START: ${session.id}`);
      if (!session.connectUrl)
        throw new Error("Browserbase session has no connectUrl");
      browser = await chromium.connectOverCDP(session.connectUrl);
    } else {
      browser = await chromium.launch({ headless: true });
    }
    const context = readOnlyMode
      ? await browser.newContext({ serviceWorkers: "block" })
      : (browser.contexts()[0] ?? (await browser.newContext()));
    const page = context.pages()[0] ?? (await context.newPage());
    activePage = page;
    await page.setViewportSize({ width: 1280, height: 800 });
    let signingIn = true;
    if (readOnlyMode) {
      await context.route("**/*", (route) => {
        const request = route.request();
        return allowsReadOnlyQaRequest(
          request.method(),
          request.url(),
          request.isNavigationRequest(),
          origin,
          target.app,
          signingIn,
        )
          ? route.continue()
          : route.abort("blockedbyclient");
      });
      await context.routeWebSocket("**/*", (socket) => socket.close());
      receipt.readOnly = true;
    }

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

    await timed(
      emailLinkMode ? "sign-in (QA email link)" : "sign-in (browser UI)",
      () => signIn(page),
    );
    identityVerified = true;
    signingIn = false;
    await timed("open app", async () => {
      await page.goto(`${appBase}${target.path ?? "/"}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page
        .waitForLoadState("networkidle", { timeout: 20_000 })
        .catch(() => undefined);
    });
    if (emailLinkMode) {
      buildEvidence.before = await readQaBuildEvidence(
        page,
        appBase,
        qaSlotEmail(),
      );
      if (buildEvidence.before) receipt.servedSha = buildEvidence.before.sha;
    }
    await shot(page, "before");
    for (const [i, step] of (target.steps ?? []).entries()) {
      await timed(`step ${i + 1} ${JSON.stringify(step).slice(0, 120)}`, () =>
        runStep(page, step),
      );
    }
    if (!readOnlyMode) {
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
      vars.write = readback;
    }
    await shot(page, "after");
    for (const [i, step] of (target.verify ?? []).entries()) {
      const beforeFocus =
        provider === "browserbase" &&
        emailLinkMode &&
        target.app === "calendar-2" &&
        "expectVisible" in step &&
        step.expectVisible === ".calendar-settings-dialog:focus-within"
          ? readCalendarSettingsFocus(page)
          : undefined;
      try {
        await timed(
          `verify ${i + 1} ${JSON.stringify(step).slice(0, 120)}`,
          () => runStep(page, step),
        );
      } catch (error) {
        if (beforeFocus) {
          const [before, afterFailure] = await Promise.all([
            beforeFocus,
            readCalendarSettingsFocus(page),
          ]);
          receipt.calendarSettingsFocus = { before, afterFailure };
        }
        throw error;
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    failure =
      emailLinkMode &&
      !identityVerified &&
      !detail.startsWith("sign-in (QA email link):")
        ? "QA email-link browser setup could not finish"
        : detail;
    const page = activePage;
    if (page && (!emailLinkMode || identityVerified))
      await shot(page, "failure").catch((shotErr: unknown) => {
        console.log(`failure screenshot not taken: ${String(shotErr)}`);
      });
  } finally {
    const cleaned: string[] = [];
    for (const fn of [
      ...cleanups,
      ...(target.cleanup ?? []).map((c) => () => {
        const page = activePage;
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
    if (emailLinkMode && identityVerified && activePage) {
      buildEvidence.after = await readQaBuildEvidence(
        activePage,
        appBase,
        qaSlotEmail(),
      );
    }
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
      replayUrl: emailLinkMode
        ? null
        : `https://www.browserbase.com/sessions/${sessionId}`,
    };
    console.log(
      `BB-SESSION: ${sessionId} ${durationSec}s ${s.status}` +
        (emailLinkMode
          ? ""
          : ` https://www.browserbase.com/sessions/${sessionId}`),
    );
  }

  const cleanFailed = (receipt.cleanup as string[]).some((c) => c !== "ok");
  receipt.steps = steps;
  if (emailLinkMode) receipt.buildEvidence = buildEvidence;
  receipt.actionReadbacks = actionReadbacks;
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

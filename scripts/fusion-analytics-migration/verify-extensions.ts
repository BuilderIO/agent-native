import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";

type JsonObject = Record<string, unknown>;

type ExtensionKind =
  | "data"
  | "gcn"
  | "qbr"
  | "engagement"
  | "dbt"
  | "query"
  | "stripe"
  | "slack"
  | "action";

type ExtensionSpec = {
  id: string;
  title: string;
  kind: ExtensionKind;
  collection?: string;
  action?: string;
  query?: string;
};

const SPECS: Record<string, ExtensionSpec> = {
  "qbr-deck-builder": {
    id: "qbr-deck-builder",
    title: "QBR Deck Builder",
    kind: "qbr",
  },
  "gcn-prep": { id: "gcn-prep", title: "GCN Conference Prep", kind: "gcn" },
  "engagement-planner": {
    id: "engagement-planner",
    title: "User Engagement Planner",
    kind: "engagement",
  },
  "customer-health": {
    id: "customer-health",
    title: "Customer Health",
    kind: "action",
    action: "bigquery",
    query: "SELECT 1 AS ok",
  },
  "risk-meeting": {
    id: "risk-meeting",
    title: "Risk Meeting",
    kind: "action",
    action: "pylon-issues",
    query: "codex verify",
  },
  stripe: {
    id: "stripe",
    title: "Stripe Billing",
    kind: "stripe",
  },
  "slack-feedback": {
    id: "slack-feedback",
    title: "Slack Feedback",
    kind: "slack",
  },
  "dbt-workspace": {
    id: "dbt-workspace",
    title: "dbt Model Workspace",
    kind: "dbt",
  },
  "query-explorer": {
    id: "query-explorer",
    title: "Query Explorer",
    kind: "query",
  },
  hubspot: {
    id: "hubspot",
    title: "HubSpot Sales",
    kind: "action",
    action: "hubspot-metrics",
  },
  sentry: {
    id: "sentry",
    title: "Sentry Error Health",
    kind: "action",
    action: "sentry",
    query: "is:unresolved",
  },
  gcloud: {
    id: "gcloud",
    title: "Google Cloud Health",
    kind: "action",
    action: "gcloud",
  },
  jira: {
    id: "jira",
    title: "Jira Tickets",
    kind: "action",
    action: "jira",
  },
  "fusion-eng": {
    id: "fusion-eng",
    title: "Fusion Engineering",
    kind: "action",
    action: "grafana",
  },
  "cx-double-click": {
    id: "cx-double-click",
    title: "CX Double Click",
    kind: "action",
    action: "bigquery",
    query: "SELECT 1 AS ok",
  },
  "onboarding-progress": {
    id: "onboarding-progress",
    title: "Onboarding Progress",
    kind: "data",
    collection: "onboarding",
  },
  "competitive-landscape": {
    id: "competitive-landscape",
    title: "Competitive Landscape",
    kind: "data",
    collection: "competitive",
  },
  "expansion-attainment": {
    id: "expansion-attainment",
    title: "Expansion Attainment Plan",
    kind: "action",
    action: "hubspot-metrics",
  },
  "strategic-accounts": {
    id: "strategic-accounts",
    title: "Strategic Accounts",
    kind: "data",
    collection: "strategic",
  },
  "agent-native-metrics": {
    id: "agent-native-metrics",
    title: "Product Double Click Metrics",
    kind: "data",
    collection: "agent-native-metrics",
  },
  "ae-pipeline": {
    id: "ae-pipeline",
    title: "AE PG Scoreboard",
    kind: "action",
    action: "hubspot-metrics",
  },
};

const args = new Map<string, string>();
const ids: string[] = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const key = arg.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith("--")) args.set(key, "true");
    else {
      args.set(key, next);
      i++;
    }
  } else {
    ids.push(arg);
  }
}

const baseUrl = (args.get("base") ?? "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
const token = args.get("token") ?? process.env.ANALYTICS_VERIFY_TOKEN;
const requested = ids.length > 0 ? ids : Object.keys(SPECS);

if (!token) {
  throw new Error("Pass --token <session token> or ANALYTICS_VERIFY_TOKEN.");
}

for (const id of requested) {
  if (!SPECS[id]) throw new Error(`Unknown extension id: ${id}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string")
          reject(new Error("No port"));
        else resolve(address.port);
      });
    });
  });
}

function chromePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  return candidates[0];
}

async function waitForJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json()) as T;
      lastErr = new Error(`${res.status} ${res.statusText}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(150);
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type CdpMessage = {
  id?: number;
  method?: string;
  params?: JsonObject;
  result?: JsonObject;
  error?: { message?: string };
};

class CdpPage {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: JsonObject) => void; reject: (err: Error) => void }
  >();
  private events: CdpMessage[] = [];
  private contextsByFrame = new Map<string, number>();

  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? "CDP error"));
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }

      if (message.method === "Runtime.executionContextCreated") {
        const context = (message.params?.context ?? {}) as {
          id?: number;
          auxData?: { frameId?: string; isDefault?: boolean };
        };
        if (
          typeof context.id === "number" &&
          context.auxData?.frameId &&
          context.auxData.isDefault !== false
        ) {
          this.contextsByFrame.set(context.auxData.frameId, context.id);
        }
      }

      if (message.method === "Runtime.executionContextDestroyed") {
        const id = (message.params?.executionContextId ?? 0) as number;
        for (const [frameId, contextId] of this.contextsByFrame.entries()) {
          if (contextId === id) this.contextsByFrame.delete(frameId);
        }
      }

      this.events.push(message);
    });
  }

  send(method: string, params: JsonObject = {}) {
    const id = this.nextId++;
    const body = JSON.stringify({ id, method, params });
    return new Promise<JsonObject>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(body);
    });
  }

  async waitForEvent(method: string, timeoutMs = 10_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const index = this.events.findIndex((event) => event.method === method);
      if (index >= 0) return this.events.splice(index, 1)[0];
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${method}`);
  }

  async navigate(url: string) {
    this.events = [];
    this.contextsByFrame.clear();
    await this.send("Page.navigate", { url });
    await this.waitForEvent("Page.loadEventFired", 20_000);
  }

  async evaluate<T>(
    expression: string,
    contextId?: number,
    timeoutMs = 20_000,
  ): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      contextId,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails as {
        text?: string;
        exception?: { description?: string; value?: string };
      };
      throw new Error(
        details.exception?.description ??
          details.exception?.value ??
          details.text ??
          "Evaluation failed",
      );
    }
    return ((result.result as { value?: T })?.value ?? null) as T;
  }

  async waitFor<T>(
    expression: string,
    contextId?: number,
    timeoutMs = 20_000,
  ): Promise<T> {
    const start = Date.now();
    let lastErr: unknown;
    while (Date.now() - start < timeoutMs) {
      try {
        const value = await this.evaluate<T>(expression, contextId);
        if (value) return value;
      } catch (err) {
        lastErr = err;
      }
      await delay(150);
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new Error(`Timed out waiting for ${expression}`);
  }

  async getExtensionContext(extensionId: string, timeoutMs = 20_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const frameTree = (await this.send("Page.getFrameTree")) as {
        frameTree?: {
          frame: { id: string; url?: string };
          childFrames?: Array<{
            frame: { id: string; url?: string };
            childFrames?: unknown[];
          }>;
        };
      };
      const frames: Array<{ id: string; url?: string }> = [];
      const visit = (node: any) => {
        if (!node) return;
        if (node.frame) frames.push(node.frame);
        for (const child of node.childFrames ?? []) visit(child);
      };
      visit(frameTree.frameTree);
      const frame = frames.find((f) =>
        f.url?.includes(`/_agent-native/extensions/${extensionId}/render`),
      );
      if (frame) {
        const contextId = this.contextsByFrame.get(frame.id);
        if (contextId) return { frameId: frame.id, contextId, url: frame.url };
      }
      await delay(150);
    }
    throw new Error(`Timed out waiting for ${extensionId} iframe context`);
  }
}

async function launchPage() {
  const port = await getFreePort();
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "an-ext-chrome-"),
  );
  const chrome = spawn(chromePath(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-allow-origins=*",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ]);

  const version = await waitForJson<{ webSocketDebuggerUrl: string }>(
    `http://127.0.0.1:${port}/json/version`,
  );
  const target = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  ).then((res) => res.json() as Promise<{ webSocketDebuggerUrl: string }>);

  const ws = new WebSocket(
    target.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl,
  );
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "error",
      () => reject(new Error("Failed to connect to Chrome CDP")),
      { once: true },
    );
  });

  const page = new CdpPage(ws);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");

  return {
    page,
    async close() {
      try {
        ws.close();
      } catch {}
      chrome.kill();
      await waitForExit(chrome);
      await fs.rm(userDataDir, { recursive: true, force: true });
    },
  };
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    setTimeout(resolve, 1_000);
  });
}

function jsString(value: string) {
  return JSON.stringify(value);
}

async function openExtension(page: CdpPage, spec: ExtensionSpec) {
  await page.navigate(
    `${baseUrl}/extensions/${encodeURIComponent(spec.id)}?_session=${encodeURIComponent(token!)}`,
  );
  const frame = await page.getExtensionContext(spec.id);
  await page.waitFor<string>(
    `document.body && document.body.innerText && document.body.innerText.includes(${jsString(spec.title)})`,
    frame.contextId,
    20_000,
  );
  const text = await page.evaluate<string>(
    "document.body.innerText",
    frame.contextId,
  );
  if (!text.includes(spec.title))
    throw new Error(`Missing title ${spec.title}`);
  if (text.includes("Authentication required")) {
    throw new Error("Extension iframe rendered unauthenticated");
  }
  return frame.contextId;
}

async function clickButton(page: CdpPage, contextId: number, label: string) {
  await page.evaluate(
    `(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === ${jsString(label)});
      if (!button) throw new Error('Missing button: ${label.replace(/'/g, "\\'")}');
      button.click();
      return true;
    })()`,
    contextId,
  );
}

async function setField(
  page: CdpPage,
  contextId: number,
  selector: string,
  value: string,
) {
  await page.evaluate(
    `(() => {
      const el = document.querySelector(${jsString(selector)});
      if (!el) throw new Error('Missing field: ${selector.replace(/'/g, "\\'")}');
      el.value = ${jsString(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
    contextId,
  );
}

async function verifyDataBrowser(
  page: CdpPage,
  contextId: number,
  spec: ExtensionSpec,
) {
  const rows = await page.waitFor<Array<{ id?: string; itemId?: string }>>(
    `extensionData.list(${jsString(spec.collection!)}, { scope: 'org' }).then((rows) => rows && rows.length ? rows : null)`,
    contextId,
    20_000,
  );
  await page.waitFor<number>(
    `document.querySelectorAll('button').length`,
    contextId,
  );
  await page.evaluate(
    `document.querySelectorAll('button')[0].click(); true`,
    contextId,
  );
  const preLength = await page.waitFor<number>(
    `(() => { const pre = document.querySelector('pre'); return pre && pre.innerText.length > 20 ? pre.innerText.length : 0; })()`,
    contextId,
  );
  return `data rows=${rows.length}, previewChars=${preLength}`;
}

async function verifyGcn(page: CdpPage, contextId: number) {
  const data = await page.waitFor<{ speakers: unknown; meetings: unknown }>(
    `Promise.all([
      extensionData.get('legacy', 'speakers', { scope: 'org' }),
      extensionData.get('legacy', 'meetings', { scope: 'org' })
    ]).then(([speakers, meetings]) => speakers && meetings ? { speakers, meetings } : null)`,
    contextId,
  );
  await clickButton(page, contextId, "speakers");
  const preLength = await page.waitFor<number>(
    `(() => { const pre = document.querySelector('pre'); return pre && pre.innerText.length > 20 ? pre.innerText.length : 0; })()`,
    contextId,
  );
  return `legacy rows=${Object.keys(data).length}, previewChars=${preLength}`;
}

async function verifyQbr(page: CdpPage, contextId: number) {
  const id = "codex-verify-qbr";
  await setField(page, contextId, "input", id);
  await setField(page, contextId, "textarea", "Extension browser verification");
  await clickButton(page, contextId, "Save QBR notes");
  const saved = await page.waitFor<{ data?: { owner?: string } }>(
    `extensionData.get('qbr-notes', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('qbr-notes', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  return `saved owner=${saved.data?.owner ?? id}`;
}

async function verifyEngagement(page: CdpPage, contextId: number) {
  const id = "Codex Verify Co";
  await setField(page, contextId, "input", id);
  await clickButton(page, contextId, "Build analysis prompt");
  const prompt = await page.waitFor<string>(
    `(() => { const textarea = document.querySelector('textarea'); return textarea && textarea.value.includes(${jsString(id)}) ? textarea.value : ''; })()`,
    contextId,
  );
  await page.waitFor(
    `extensionData.get('prompts', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('prompts', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  return `promptChars=${prompt.length}`;
}

async function verifyDbt(page: CdpPage, contextId: number) {
  const id = "codex-verify-dbt";
  await setField(page, contextId, "input", id);
  await setField(page, contextId, "textarea", "SELECT 1 AS ok");
  await clickButton(page, contextId, "Save");
  const saved = await page.waitFor<{ data?: { sql?: string } }>(
    `extensionData.get('models', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('models', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  return `savedSql=${saved.data?.sql ?? ""}`;
}

async function verifyQuery(page: CdpPage, contextId: number) {
  await setField(page, contextId, "textarea", "SELECT 1 AS ok");
  await clickButton(page, contextId, "Run BigQuery");
  const output = await page.waitFor<string>(
    `(() => {
      const error = document.querySelector('.text-red-600')?.innerText || '';
      const pre = document.querySelector('pre')?.innerText || '';
      return pre || error || '';
    })()`,
    contextId,
    45_000,
  );
  const history = await page.evaluate<
    Array<{ id: string; data?: { sql?: string } }>
  >(`extensionData.list('history', { scope: 'org' })`, contextId);
  for (const row of history.filter(
    (row) => row.data?.sql === "SELECT 1 AS ok",
  )) {
    await page.evaluate(
      `extensionData.remove('history', ${jsString(row.id)}, { scope: 'org' })`,
      contextId,
    );
  }
  if (
    /Action not found|Missing required|Authentication required/i.test(output)
  ) {
    throw new Error(output);
  }
  return `outputChars=${output.length}`;
}

async function verifyStripe(page: CdpPage, contextId: number) {
  await setField(page, contextId, "input", "codex-verification@example.com");
  const mode = await page.evaluate<string>(
    `document.querySelector('select')?.value || ''`,
    contextId,
  );
  return `controls query+mode ready (${mode})`;
}

async function verifySlack(page: CdpPage, contextId: number) {
  await setField(page, contextId, "input", "codex verify");
  const value = await page.evaluate<string>(
    `document.querySelector('input')?.value || ''`,
    contextId,
  );
  return `search input ready (${value})`;
}

async function verifyAction(
  page: CdpPage,
  contextId: number,
  spec: ExtensionSpec,
) {
  if (spec.query) await setField(page, contextId, "input", spec.query);
  await clickButton(page, contextId, spec.action!);
  const output = await page.waitFor<string>(
    `(() => {
      const sections = [...document.querySelectorAll('section')];
      const hit = sections.find((section) => section.innerText.includes(${jsString(spec.action!)}));
      const pre = hit?.querySelector('pre')?.innerText || '';
      const error = document.querySelector('.text-red-600')?.innerText || '';
      return pre || error || '';
    })()`,
    contextId,
    45_000,
  );
  if (
    /Action not found|Unknown action|Missing required|Authentication required/i.test(
      output,
    )
  ) {
    throw new Error(output);
  }
  return `${spec.action} outputChars=${output.length}`;
}

async function verifyOne(page: CdpPage, spec: ExtensionSpec) {
  const contextId = await openExtension(page, spec);
  const details =
    spec.kind === "data"
      ? await verifyDataBrowser(page, contextId, spec)
      : spec.kind === "gcn"
        ? await verifyGcn(page, contextId)
        : spec.kind === "qbr"
          ? await verifyQbr(page, contextId)
          : spec.kind === "engagement"
            ? await verifyEngagement(page, contextId)
            : spec.kind === "dbt"
              ? await verifyDbt(page, contextId)
              : spec.kind === "query"
                ? await verifyQuery(page, contextId)
                : spec.kind === "stripe"
                  ? await verifyStripe(page, contextId)
                  : spec.kind === "slack"
                    ? await verifySlack(page, contextId)
                    : await verifyAction(page, contextId, spec);
  const errors = await page.evaluate<string[]>(
    `window._extensionErrors || []`,
    contextId,
  );
  if (errors.length > 0) throw new Error(errors.join("; "));
  return details;
}

const browser = await launchPage();
const results: Array<{ id: string; ok: boolean; details: string }> = [];

try {
  for (const id of requested) {
    const spec = SPECS[id];
    try {
      const details = await verifyOne(browser.page, spec);
      results.push({ id, ok: true, details });
      console.log(`PASS ${id}: ${details}`);
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err);
      results.push({ id, ok: false, details });
      console.log(`FAIL ${id}: ${details}`);
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.log(JSON.stringify({ ok: false, results }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

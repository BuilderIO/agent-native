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
  | "cs-qbr"
  | "discovery"
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
  "cs-qbr-deck-builder": {
    id: "cs-qbr-deck-builder",
    title: "CS QBR Deck Builder",
    kind: "cs-qbr",
  },
  "discovery-coach": {
    id: "discovery-coach",
    title: "Discovery Coach",
    kind: "discovery",
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

const OOPIF_CONTEXT = -1;

class CdpPage {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: JsonObject) => void; reject: (err: Error) => void }
  >();
  private events: CdpMessage[] = [];
  private contextsByFrame = new Map<string, number>();
  private childPages: CdpPage[] = [];
  private oopifPage: CdpPage | null = null;

  constructor(
    private ws: WebSocket,
    private debugPort?: number,
  ) {
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
    if (contextId === OOPIF_CONTEXT && this.oopifPage) {
      return this.oopifPage.evaluate<T>(expression, undefined, timeoutMs);
    }
    const params: JsonObject = {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: timeoutMs,
    };
    if (typeof contextId === "number") params.contextId = contextId;
    const result = await this.send("Runtime.evaluate", params);
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
        const isolated = (await this.send("Page.createIsolatedWorld", {
          frameId: frame.id,
          worldName: `codex-verify-${extensionId}`,
          grantUniveralAccess: true,
        })) as { executionContextId?: number };
        if (typeof isolated.executionContextId === "number") {
          return {
            frameId: frame.id,
            contextId: isolated.executionContextId,
            url: frame.url,
          };
        }
      }
      const iframeTarget = await this.findIframeTarget(extensionId);
      if (iframeTarget?.webSocketDebuggerUrl) {
        this.oopifPage = await CdpPage.connect(
          iframeTarget.webSocketDebuggerUrl,
        );
        this.childPages.push(this.oopifPage);
        await this.oopifPage.send("Runtime.enable");
        await this.oopifPage.send("Network.enable");
        return {
          frameId: iframeTarget.id,
          contextId: OOPIF_CONTEXT,
          url: iframeTarget.url,
        };
      }
      await delay(150);
    }
    throw new Error(`Timed out waiting for ${extensionId} iframe context`);
  }

  private async findIframeTarget(extensionId: string): Promise<
    | {
        id: string;
        type: string;
        url: string;
        webSocketDebuggerUrl?: string;
      }
    | undefined
  > {
    if (!this.debugPort) return undefined;
    const targets = (await fetch(
      `http://127.0.0.1:${this.debugPort}/json/list`,
    ).then((res) => res.json())) as Array<{
      id: string;
      type: string;
      url: string;
      webSocketDebuggerUrl?: string;
    }>;
    return targets.find(
      (target) =>
        target.type === "iframe" &&
        target.url.includes(`/_agent-native/extensions/${extensionId}/render`),
    );
  }

  static async connect(wsUrl: string) {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error("Failed to connect to Chrome CDP")),
        { once: true },
      );
    });
    return new CdpPage(ws);
  }

  close() {
    for (const child of this.childPages) child.close();
    try {
      this.ws.close();
    } catch {}
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

  const page = new CdpPage(ws, port);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Network.enable");

  return {
    page,
    async close() {
      page.close();
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
  await page.waitFor(
    `(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === ${jsString(label)});
      return button && !button.disabled;
    })()`,
    contextId,
  );
  await page.evaluate(
    `(() => {
      const button = [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === ${jsString(label)});
      if (!button) throw new Error('Missing button: ${label.replace(/'/g, "\\'")}');
      if (button.disabled) throw new Error('Button is disabled: ${label.replace(/'/g, "\\'")}');
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
  await setField(
    page,
    contextId,
    "textarea[placeholder='Quarter goals']",
    "Extension browser verification",
  );
  await clickButton(page, contextId, "Save form");
  const saved = await page.waitFor<{ data?: { owner?: string } }>(
    `extensionData.get('qbr-notes', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  await clickButton(page, contextId, "Preview deck");
  await page.waitFor<string>(
    `document.body.innerText.includes('Sales QBR Preview') && document.body.innerText.includes(${jsString(id)})`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('qbr-notes', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  return `saved owner=${saved.data?.owner ?? id}`;
}

async function verifyCsQbr(page: CdpPage, contextId: number) {
  const testOwner = "Codex Verify CSM";
  const seeded = await page.waitFor<{ data?: unknown }>(
    `extensionData.get('cs-qbr-notes', 'Alex Beebe', { scope: 'org' })`,
    contextId,
  );
  const ownerCount = await page.waitFor<number>(
    `(() => { const select = document.querySelector('select'); return select && select.options.length > 1 ? select.options.length - 1 : 0; })()`,
    contextId,
    30_000,
  );
  const alexState = await page.evaluate<{
    selected?: string;
    accountCount?: number;
    arr?: number;
    error?: string;
    loadedSeed?: boolean;
  }>(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.selectOwner === 'function');
      if (!state) throw new Error('Missing CS QBR Alpine state');
      const select = document.querySelector('select');
      const hasAlexOption = select && [...select.options].some((option) => option.value === 'Alex Beebe');
      if (hasAlexOption) {
        select.value = 'Alex Beebe';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        await state.selectOwner('Alex Beebe');
      }
      const started = Date.now();
      while ((state.loadingBook || state.selected !== 'Alex Beebe') && Date.now() - started < 45000) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return {
        selected: state.selected,
        accountCount: state.metrics?.accountCount ?? 0,
        arr: state.metrics?.arr ?? 0,
        error: state.error || '',
        loadedSeed: state.form?.csmName === 'Alex Beebe'
      };
    })()`,
    contextId,
    60_000,
  );
  if (alexState.error && !alexState.loadedSeed) {
    throw new Error(alexState.error);
  }
  await clickButton(page, contextId, "View Deck");
  await page.waitFor<string>(
    `document.body.innerText.includes('CS QBR Preview') && document.body.innerText.includes('Alex Beebe')`,
    contextId,
  );
  await page.evaluate(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.resetForm === 'function');
      if (!state) throw new Error('Missing CS QBR Alpine state');
      state.selected = ${jsString(testOwner)};
      state.deckOpen = false;
      state.resetForm(${jsString(testOwner)});
      state.book = { rows: [] };
      state.computeMetrics();
      return true;
    })()`,
    contextId,
  );
  await setField(
    page,
    contextId,
    "textarea[placeholder='Q1 lesson learned']",
    "CS QBR extension browser verification",
  );
  await setField(page, contextId, "input[placeholder='Ask 1']", "Verify deck");
  await clickButton(page, contextId, "Save notes");
  const saved = await page.waitFor<{ data?: { csmName?: string } }>(
    `extensionData.get('cs-qbr-notes', ${jsString(testOwner)}, { scope: 'org' })`,
    contextId,
  );
  await clickButton(page, contextId, "View Deck");
  await page.waitFor<string>(
    `document.body.innerText.includes(${jsString(testOwner)}) && document.body.innerText.includes('CS QBR extension browser verification')`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('cs-qbr-notes', ${jsString(testOwner)}, { scope: 'org' })`,
    contextId,
  );
  return `owners=${ownerCount}, alexSeed=${Boolean(seeded)}, alexAccounts=${alexState.accountCount ?? 0}, saved=${saved.data?.csmName ?? testOwner}`;
}

async function verifyDiscoveryCoach(page: CdpPage, contextId: number) {
  const counts = await page.evaluate<{
    stages: number;
    pains: number;
    wonSignals: number;
    lostSignals: number;
  }>(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && candidate.opPains && candidate.stages);
      if (!state) throw new Error('Missing Discovery Coach Alpine state');
      return {
        stages: state.stages?.length || 0,
        pains: state.opPains?.length || 0,
        wonSignals: state.wonSignals?.length || 0,
        lostSignals: state.lostSignals?.length || 0
      };
    })()`,
    contextId,
  );
  if (!counts.stages || !counts.pains || !counts.wonSignals) {
    throw new Error(`Discovery data missing: ${JSON.stringify(counts)}`);
  }
  await clickButton(page, contextId, "Pain translation map");
  await page.waitFor<string>(
    `document.body.innerText.includes('Pain translation map')`,
    contextId,
  );
  await clickButton(page, contextId, "Win/loss signals");
  await page.waitFor<string>(
    `document.body.innerText.includes('Won deals') && document.body.innerText.includes('Lost deals')`,
    contextId,
  );
  await clickButton(page, contextId, "Operational pains");
  await page.evaluate(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && candidate.opPains && candidate.stages);
      state.selectedPain = 0;
      return true;
    })()`,
    contextId,
  );
  await page.waitFor<string>(
    `document.body.innerText.includes('Listen for:')`,
    contextId,
  );
  return `stages=${counts.stages}, pains=${counts.pains}, signals=${counts.wonSignals + counts.lostSignals}`;
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
          : spec.kind === "cs-qbr"
            ? await verifyCsQbr(page, contextId)
            : spec.kind === "discovery"
              ? await verifyDiscoveryCoach(page, contextId)
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

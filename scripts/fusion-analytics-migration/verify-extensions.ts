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
  | "ae-pipeline"
  | "discovery"
  | "engagement"
  | "dbt"
  | "query"
  | "stripe"
  | "slack"
  | "rich-ui"
  | "data-ui"
  | "explorer"
  | "action";

type ExtensionSpec = {
  id: string;
  title: string;
  kind: ExtensionKind;
  collection?: string;
  action?: string;
  query?: string;
  expectedText?: string[];
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
    kind: "rich-ui",
    expectedText: [
      "Fusion Activity",
      "Top Fusion Users",
      "Subscriptions and Spaces",
      "Support Tickets (Pylon)",
      "Recent Calls (Gong)",
    ],
  },
  "risk-meeting": {
    id: "risk-meeting",
    title: "Risk Meeting",
    kind: "rich-ui",
    expectedText: ["HubSpot Flagged", "Pylon Early Warning"],
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
  explorer: {
    id: "explorer",
    title: "Explorer",
    kind: "explorer",
    expectedText: ["Events", "SQL Query", "Run BigQuery"],
  },
  hubspot: {
    id: "hubspot",
    title: "HubSpot Sales",
    kind: "rich-ui",
    expectedText: ["Pipeline Board", "POV Deals", "Deal Lookup"],
  },
  sentry: {
    id: "sentry",
    title: "Sentry Error Health",
    kind: "rich-ui",
    expectedText: ["Total Events", "Unresolved Issues", "Top Issues"],
  },
  gcloud: {
    id: "gcloud",
    title: "Google Cloud Health",
    kind: "rich-ui",
    expectedText: ["Avg Request Rate", "Recent Logs", "Requests"],
  },
  jira: {
    id: "jira",
    title: "Jira Tickets",
    kind: "rich-ui",
    expectedText: ["Open Issues", "Created", "Search"],
  },
  "fusion-eng": {
    id: "fusion-eng",
    title: "Fusion Engineering",
    kind: "rich-ui",
    expectedText: ["Dashboards", "Alert Rules", "Grafana Dashboards"],
  },
  "cx-double-click": {
    id: "cx-double-click",
    title: "CX Double Click",
    kind: "rich-ui",
    expectedText: [
      "NDR Trend",
      "Upcoming Renewals by Risk",
      "Pylon Aging by Account",
    ],
  },
  "onboarding-progress": {
    id: "onboarding-progress",
    title: "Onboarding Progress",
    kind: "data-ui",
    collection: "onboarding",
    expectedText: [
      "Onboarding Customers Only",
      "Goals",
      "What changed",
      "Recent activity",
    ],
  },
  "competitive-landscape": {
    id: "competitive-landscape",
    title: "Competitive Landscape",
    kind: "data-ui",
    collection: "competitive",
    expectedText: [
      "Gong Transcript Analysis",
      "Monthly Competitor Mentions",
      "Methodology",
    ],
  },
  "expansion-attainment": {
    id: "expansion-attainment",
    title: "Expansion Attainment Plan",
    kind: "rich-ui",
    expectedText: [
      "Scenario Parameters",
      "Projected Attainment",
      "Quarterly Execution Plan",
      "Account Prioritization",
    ],
  },
  "strategic-accounts": {
    id: "strategic-accounts",
    title: "Strategic Accounts",
    kind: "data-ui",
    collection: "strategic",
    expectedText: ["Clear Coverage", "Implementation blockers"],
  },
  "agent-native-metrics": {
    id: "agent-native-metrics",
    title: "Product Double Click Metrics",
    kind: "data-ui",
    collection: "agent-native-metrics",
    expectedText: [
      "npm package downloads per week",
      "OSS contributors over time",
      "GitHub stars over time",
    ],
  },
  "ae-pipeline": {
    id: "ae-pipeline",
    title: "AE PG Scoreboard",
    kind: "ae-pipeline",
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

async function enableTargetDiscovery(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "error",
      () => reject(new Error("Failed to connect to Chrome browser CDP")),
      { once: true },
    );
  });
  await new Promise<void>((resolve, reject) => {
    const id = 1;
    const timeout = setTimeout(
      () => reject(new Error("Timed out enabling target discovery")),
      5_000,
    );
    ws.addEventListener(
      "message",
      (event) => {
        const message = JSON.parse(String(event.data)) as CdpMessage;
        if (message.id !== id) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolve();
      },
      { once: false },
    );
    ws.send(
      JSON.stringify({
        id,
        method: "Target.setDiscoverTargets",
        params: { discover: true },
      }),
    );
  });
  return ws;
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
  const browserWs = await enableTargetDiscovery(version.webSocketDebuggerUrl);
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
      try {
        browserWs.close();
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
  await prepareDataUi(page, contextId, spec);
  const details = await verifyRichUi(page, contextId, spec, {
    allowEmptyState: true,
  });
  return `data rows=${rows.length}, ${details}`;
}

async function prepareDataUi(
  page: CdpPage,
  contextId: number,
  spec: ExtensionSpec,
) {
  if (spec.id === "onboarding-progress") {
    const counts = await page.waitFor<{ allRows: number; visibleRows: number }>(
      `(() => {
        const state = [...document.querySelectorAll('*')]
          .map((el) => el._x_dataStack?.[0])
          .find((candidate) => candidate && Array.isArray(candidate.allRows) && typeof candidate.visibleRows === 'function');
        if (!state || state.loading) return null;
        state.onboardingOnly = false;
        const visible = state.visibleRows();
        state.selectedOrgId = visible[0]?.orgId || null;
        return { allRows: state.allRows.length, visibleRows: visible.length, error: state.error || '' };
      })()`,
      contextId,
    );
    if (!counts.allRows) throw new Error("Onboarding rows did not load");
    await delay(200);
  }

  if (spec.id === "strategic-accounts") {
    const counts = await page.waitFor<{
      accounts: number;
      blockers: number;
      error?: string;
    }>(
      `(() => {
        const state = [...document.querySelectorAll('*')]
          .map((el) => el._x_dataStack?.[0])
          .find((candidate) => candidate && Array.isArray(candidate.accounts) && Array.isArray(candidate.blockers));
        if (!state || state.loading) return null;
        state.selectedName = state.accounts[0]?.name || '';
        return { accounts: state.accounts.length, blockers: state.blockers.length, error: state.error || '' };
      })()`,
      contextId,
    );
    if (counts.error) throw new Error(counts.error);
    if (!counts.accounts) {
      throw new Error("Strategic account source parser produced 0 accounts");
    }
    await delay(200);
  }
}

async function verifyRichUi(
  page: CdpPage,
  contextId: number,
  spec: ExtensionSpec,
  opts: { allowEmptyState?: boolean } = {},
) {
  const expected = spec.expectedText ?? [];
  const summary = await page.waitFor<{
    text: string;
    error?: string;
    loading?: boolean;
  }>(
    `(() => {
      const expected = ${JSON.stringify(expected)};
      const states = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .filter(Boolean);
      const loadingState = states.find((candidate) => Object.prototype.hasOwnProperty.call(candidate, 'loading'));
      if (loadingState?.loading) return null;
      const text = document.body.innerText || '';
      if (expected.some((phrase) => !text.includes(phrase))) return null;
      return {
        text,
        error: loadingState?.error || '',
        loading: !!loadingState?.loading
      };
    })()`,
    contextId,
    90_000,
  );
  const text = summary.text.replace(/\s+/g, " ");
  const missing = (spec.expectedText ?? []).filter(
    (phrase) => !text.includes(phrase),
  );
  if (missing.length > 0) {
    throw new Error(`Missing rich UI labels: ${missing.join(", ")}`);
  }
  if (
    text.includes("Search term, company, project, or query") ||
    text.includes("Loading migrated SQL data...")
  ) {
    throw new Error("Generic JSON/search migration shell is still visible");
  }
  if (
    summary.error &&
    /Action not found|Unknown action|Missing required|Authentication required|not connected|credentials/i.test(
      summary.error,
    )
  ) {
    throw new Error(summary.error);
  }
  if (!opts.allowEmptyState && text.length < 100) {
    throw new Error("Rendered rich UI text is unexpectedly small");
  }
  return `richUiText=${text.length}`;
}

async function verifyGcn(page: CdpPage, contextId: number) {
  const data = await page.waitFor<{
    speakers: number;
    meetings: number;
    error?: string;
  }>(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.speakers) && Array.isArray(candidate.meetings));
      if (!state || state.loading) return null;
      return { speakers: state.speakers.length, meetings: state.meetings.length, error: state.error || '' };
    })()`,
    contextId,
  );
  if (data.error) throw new Error(data.error);
  await clickButton(page, contextId, "Speaker List");
  await page.waitFor(
    `document.body.innerText.includes('Speaker List') && document.body.innerText.includes('All AEs')`,
    contextId,
  );
  await clickButton(page, contextId, "Cabana Meetings");
  await page.waitFor(
    `document.body.innerText.includes('Cabana Meetings') && document.body.innerText.includes('Meetings')`,
    contextId,
  );
  return `speakers=${data.speakers}, meetings=${data.meetings}`;
}

async function verifyQbr(page: CdpPage, contextId: number) {
  const id = "Codex Verify AE";
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.selectOwner === 'function'))()`,
    contextId,
    90_000,
  );
  const selected = await page.evaluate<{
    owner?: string;
    hasHubspot?: boolean;
  }>(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.selectOwner === 'function');
      if (!state) throw new Error('Missing QBR Alpine state');
      const select = document.querySelector('select');
      const hasAndrewOption = select && [...select.options].some((option) => option.value === 'Andrew Bishop');
      if (hasAndrewOption) {
        select.value = 'Andrew Bishop';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        await state.selectOwner('Andrew Bishop');
      }
      const started = Date.now();
      while ((state.loading || state.owner !== 'Andrew Bishop') && Date.now() - started < 45000) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { owner: state.owner, hasHubspot: !!state.hs };
    })()`,
    contextId,
    60_000,
  );
  if (selected.owner !== "Andrew Bishop") {
    throw new Error(`QBR owner did not select: ${selected.owner}`);
  }
  await clickButton(page, contextId, "View Deck");
  await page.waitFor<string>(
    `(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('ae qbr deck') && text.includes('andrew bishop');
    })()`,
    contextId,
  );
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.save === 'function'))()`,
    contextId,
    90_000,
  );
  await page.evaluate(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.save === 'function');
      if (!state) throw new Error('Missing QBR Alpine state');
      state.deckOpen = false;
      state.owner = ${jsString(id)};
      state.form = state.emptyForm();
      state.form.q2SmartGoals = 'Sales QBR extension browser verification';
      state.form.ask1 = 'Verify Agent Native deck builder';
      await state.save();
      return true;
    })()`,
    contextId,
  );
  const saved = await page.waitFor<{ data?: { owner?: string } }>(
    `extensionData.get('qbr-notes', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('qbr-notes', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  return `selected=${selected.owner}, hubspot=${selected.hasHubspot}, saved=${saved.data?.owner ?? id}`;
}

async function verifyAePipeline(page: CdpPage, contextId: number) {
  const state = await page.waitFor<{
    rows: number;
    managers: number;
    error?: string;
    text?: string;
  }>(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.filteredRows === 'function');
      if (!state || state.loading) return null;
      return {
        rows: state.rows?.length || 0,
        managers: state.managers?.length || 0,
        error: state.error || '',
        text: document.body.innerText
      };
    })()`,
    contextId,
    60_000,
  );
  if (state.error) throw new Error(state.error);
  if (!state.rows || !state.managers) {
    throw new Error(`AE pipeline rows missing: ${JSON.stringify(state)}`);
  }
  const text = state.text?.toLowerCase() ?? "";
  if (
    !text.includes("by manager") ||
    !text.includes("by ae") ||
    !text.includes("s1 pipeline")
  ) {
    throw new Error("AE pipeline UI did not render manager/AE scoreboard");
  }
  await page.evaluate(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.filteredRows === 'function');
      state.aeType = 'EAE';
      state.manager = state.managers[0]?.manager || 'all';
      return state.filteredRows().length;
    })()`,
    contextId,
  );
  return `rows=${state.rows}, managers=${state.managers}`;
}

type CsQbrEntryUiSummary = {
  accountCount: number;
  renewalItems: number;
  adoptionItems: number;
  pipelineItems: number;
  missing?: string[];
  textPreview?: string;
};

function csQbrEntryUiExpression(requireComplete: boolean) {
  return `(() => {
    const state = [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .find((candidate) => candidate && typeof candidate.selectOwner === 'function');
    if (!state || state.loadingBook || !state.selected || state.deckOpen || !state.metrics) return null;
    if (state.adoptionOpen === false) {
      state.adoptionOpen = true;
      return null;
    }

    const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const missing = [];
    const includesAny = (phrases) => phrases.some((phrase) => lower.includes(phrase));
    const expectText = (label, phrases) => {
      if (!includesAny(phrases)) missing.push(label);
    };
    const itemNames = (items) => items
      .map((item) => String(item?.company_name || item?.name || '').trim())
      .filter(Boolean);
    const expectTableOrEmpty = (label, items, emptyPhrases) => {
      const names = itemNames(items);
      const hasVisibleRow = names.some((name) => lower.includes(name.toLowerCase()));
      if (names.length > 0 ? !hasVisibleRow : !includesAny(emptyPhrases)) {
        missing.push(label);
      }
    };

    const renewals = typeof state.renewalAccounts === 'function' ? state.renewalAccounts() : [];
    const adoptions = typeof state.adoptionAccounts === 'function' ? state.adoptionAccounts() : [];
    const pipeline = typeof state.expansionPipeline === 'function' ? state.expansionPipeline() : [];

    expectText('Data Loaded', ['data loaded']);
    expectText('Retention', ['retention']);
    expectText('Product Adoption', ['product adoption']);
    expectText('Expansion', ['expansion']);
    expectText('Estimated Variable Compensation / Variable Comp', [
      'estimated variable compensation',
      'variable comp'
    ]);
    expectTableOrEmpty('renewal table or empty state', renewals, [
      'no renewal',
      'no renewals',
      'none this quarter',
      'no upcoming renewals'
    ]);
    expectTableOrEmpty('adoption table or empty state', adoptions, [
      'no adoption',
      'no product adoption',
      'no utilization',
      'no account data',
      'no accounts to show'
    ]);
    expectTableOrEmpty('pipeline table or empty state', pipeline, [
      'no open pipeline',
      'no pipeline',
      'no expansion pipeline',
      'no pipeline data'
    ]);

    const summary = {
      accountCount: state.metrics?.accountCount ?? 0,
      renewalItems: renewals.length,
      adoptionItems: adoptions.length,
      pipelineItems: pipeline.length,
      missing,
      textPreview: text.slice(0, 500)
    };
    return ${requireComplete ? "missing.length ? null : summary" : "summary"};
  })()`;
}

async function verifyCsQbrEntryUi(page: CdpPage, contextId: number) {
  try {
    return await page.waitFor<CsQbrEntryUiSummary>(
      csQbrEntryUiExpression(true),
      contextId,
      20_000,
    );
  } catch (err) {
    const summary = await page.evaluate<CsQbrEntryUiSummary | null>(
      csQbrEntryUiExpression(false),
      contextId,
    );
    if (summary?.missing?.length) {
      throw new Error(
        `CS QBR entry UI missing: ${summary.missing.join(", ")}. Visible text: ${summary.textPreview ?? ""}`,
      );
    }
    throw err;
  }
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
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.selectOwner === 'function'))()`,
    contextId,
    90_000,
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
  const entryUi = await verifyCsQbrEntryUi(page, contextId);
  await clickButton(page, contextId, "View Deck");
  await page.waitFor<{ slide?: number; slides?: number }>(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.slides));
      const text = document.body.innerText.toLowerCase();
      return state?.deckOpen && state.slide === 0 && text.includes('quarterly business review') && text.includes('alex beebe')
        ? { slide: state.slide, slides: state.slides.length }
        : null;
    })()`,
    contextId,
  );
  await clickButton(page, contextId, "Next");
  await page.waitFor(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.slides));
      const text = document.body.innerText.toLowerCase();
      return state?.slide === 1 && text.includes('key lesson from q1');
    })()`,
    contextId,
  );
  await clickButton(page, contextId, "3. Retention");
  await page.waitFor(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.slides));
      const text = document.body.innerText.toLowerCase();
      return state?.slide === 2 && text.includes('retention health') && text.includes('variable comp');
    })()`,
    contextId,
  );
  await clickButton(page, contextId, "Exit");
  await page.waitFor(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.slides));
      return state && !state.deckOpen;
    })()`,
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
    "textarea[x-model='form.q1LessonLearned']",
    "CS QBR extension browser verification",
  );
  await setField(page, contextId, "input[placeholder='Ask 1']", "Verify deck");
  await clickButton(page, contextId, "Save notes");
  const saved = await page.waitFor<{ data?: { csmName?: string } }>(
    `extensionData.get('cs-qbr-notes', ${jsString(testOwner)}, { scope: 'org' })`,
    contextId,
  );
  await clickButton(page, contextId, "View Deck");
  await page.waitFor(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.slides));
      return state?.deckOpen && state.slide === 0;
    })()`,
    contextId,
  );
  await clickButton(page, contextId, "Next");
  await page.waitFor<string>(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.slides));
      return state?.slide === 1 && document.body.innerText.includes('CS QBR extension browser verification');
    })()`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('cs-qbr-notes', ${jsString(testOwner)}, { scope: 'org' })`,
    contextId,
  );
  return `owners=${ownerCount}, alexSeed=${Boolean(seeded)}, alexAccounts=${alexState.accountCount ?? 0}, entryRenewals=${entryUi.renewalItems}, entryAdoption=${entryUi.adoptionItems}, entryPipeline=${entryUi.pipelineItems}, saved=${saved.data?.csmName ?? testOwner}`;
}

async function verifyDiscoveryCoach(page: CdpPage, contextId: number) {
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && candidate.opPains && candidate.stages))()`,
    contextId,
    90_000,
  );
  const counts = await page.evaluate<{
    stages: number;
    pains: number;
    personas: number;
    businessPains: number;
    translations: number;
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
        personas: state.personas?.length || 0,
        businessPains: Object.keys(state.businessPains || {}).length,
        translations: state.translationMap?.length || 0,
        wonSignals: state.wonSignals?.length || 0,
        lostSignals: state.lostSignals?.length || 0
      };
    })()`,
    contextId,
  );
  if (
    !counts.stages ||
    !counts.pains ||
    !counts.personas ||
    !counts.businessPains ||
    !counts.translations ||
    !counts.wonSignals
  ) {
    throw new Error(`Discovery data missing: ${JSON.stringify(counts)}`);
  }
  await clickButton(page, contextId, "Persona guide");
  await page.waitFor<string>(
    `document.body.innerText.includes('Opening questions') && document.body.innerText.includes('Connect to buyer')`,
    contextId,
  );
  await clickButton(page, contextId, "Developer / Engineer");
  await clickButton(page, contextId, "What they say vs. mean");
  await page.evaluate(
    `(() => {
      const label = [...document.querySelectorAll('*')]
        .find((el) => el.textContent && el.textContent.trim() === 'They say:');
      const card = label?.closest('.overflow-hidden');
      const trigger = card?.querySelector('.cursor-pointer');
      if (!trigger) throw new Error('Missing persona pain trigger');
      trigger.click();
      return true;
    })()`,
    contextId,
  );
  await page.waitFor<string>(
    `document.body.innerText.includes('What they mean') && document.body.innerText.includes('Business pain to find')`,
    contextId,
  );
  await clickButton(page, contextId, "Pain translation map");
  await page.waitFor<string>(
    `document.body.innerText.includes('Pain translation map')`,
    contextId,
  );
  await clickButton(page, contextId, "Win / loss signals");
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
      if (!state) throw new Error('Missing Discovery Coach Alpine state');
      state.selectedPain = 0;
      state.expandedPainQuestions = [0];
      return true;
    })()`,
    contextId,
  );
  await page.waitFor<string>(
    `document.body.innerText.includes('Listen for:')`,
    contextId,
  );
  await clickButton(page, contextId, "Business pains");
  await page.evaluate(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && candidate.opPains && candidate.stages);
      if (!state) throw new Error('Missing Discovery Coach Alpine state');
      state.expandedBusinessPainIds = [Object.keys(state.businessPains || {})[0]].filter(Boolean);
      return true;
    })()`,
    contextId,
  );
  await page.waitFor<string>(
    `document.body.innerText.includes('Forcing function question') && document.body.innerText.includes('Won examples')`,
    contextId,
  );
  return `stages=${counts.stages}, pains=${counts.pains}, personas=${counts.personas}, businessPains=${counts.businessPains}, signals=${counts.wonSignals + counts.lostSignals}`;
}

async function verifyEngagement(page: CdpPage, contextId: number) {
  const id = "codex-verify-engagement-root";
  const company = "Codex Verify Co";
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.generateStrategy === 'function'))()`,
    contextId,
    90_000,
  );
  const prompt = await page.evaluate<string>(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.generateStrategy === 'function');
      if (!state) throw new Error('Missing Engagement Planner Alpine state');
      state.orgIdInput = ${jsString(company)};
      state.orgData = {
        root_org_id: ${jsString(id)},
        company_name: ${jsString(company)},
        user_count: 4,
        message_count: 42,
        email_domain: 'codex.test'
      };
      await state.generateStrategy();
      return state.prompt || '';
    })()`,
    contextId,
  );
  if (!prompt.includes(company) || !prompt.includes(id)) {
    throw new Error("Engagement prompt did not include verified org context");
  }
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
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.saveSnippet === 'function'))()`,
    contextId,
    90_000,
  );
  await page.evaluate(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.saveSnippet === 'function');
      if (!state) throw new Error('Missing dbt Workspace Alpine state');
      state.selectedFile = ${jsString(id)};
      state.modelSql = 'SELECT 1 AS ok';
      state.testSql = 'SELECT 1 AS ok';
      await state.saveSnippet();
      return true;
    })()`,
    contextId,
  );
  const saved = await page.waitFor<{
    data?: string | { sql?: string; value?: { sql?: string } };
  }>(
    `extensionData.get('models', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  await page.evaluate(
    `extensionData.remove('models', ${jsString(id)}, { scope: 'org' })`,
    contextId,
  );
  const savedData =
    typeof saved.data === "string" ? JSON.parse(saved.data) : saved.data;
  const sql = savedData?.sql ?? savedData?.value?.sql ?? "";
  if (sql !== "SELECT 1 AS ok") {
    throw new Error("dbt snippet did not persist expected SQL");
  }
  return `savedSql=${sql}`;
}

async function verifyQuery(page: CdpPage, contextId: number) {
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.run === 'function' && Array.isArray(candidate.history)))()`,
    contextId,
    90_000,
  );
  const output = await page.evaluate<{
    error?: string;
    rowCount?: number;
    historyCount?: number;
  }>(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.run === 'function' && Array.isArray(candidate.history));
      if (!state) throw new Error('Missing Query Explorer Alpine state');
      state.sql = 'SELECT 1 AS ok';
      await state.run();
      return { error: state.error || '', rowCount: (state.result?.rows || []).length, historyCount: state.history.length };
    })()`,
    contextId,
    45_000,
  );
  const history = await page.evaluate<
    Array<{
      id: string;
      data?: string | { sql?: string; value?: { sql?: string } };
    }>
  >(`extensionData.list('query-history', { scope: 'org' })`, contextId);
  const rowSql = (row: (typeof history)[number]) => {
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    return data?.sql ?? data?.value?.sql;
  };
  for (const row of history.filter((row) => rowSql(row) === "SELECT 1 AS ok")) {
    await page.evaluate(
      `extensionData.remove('query-history', ${jsString(row.id)}, { scope: 'org' })`,
      contextId,
    );
  }
  if (
    output.error &&
    /Action not found|Missing required|Authentication required/i.test(
      output.error,
    )
  ) {
    throw new Error(output.error);
  }
  return `rows=${output.rowCount}, history=${output.historyCount}`;
}

async function verifyStripe(page: CdpPage, contextId: number) {
  await page.waitFor(
    `(() => [...document.querySelectorAll('*')]
      .map((el) => el._x_dataStack?.[0])
      .some((candidate) => candidate && typeof candidate.run === 'function' && typeof candidate.activeSubscriptions === 'function'))()`,
    contextId,
    90_000,
  );
  const state = await page.evaluate<{
    submittedSearch?: string;
    hasSections?: boolean;
    error?: string;
  }>(
    `(async () => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && typeof candidate.run === 'function' && typeof candidate.activeSubscriptions === 'function');
      if (!state) throw new Error('Missing Stripe Alpine state');
      state.query = 'codex-verification@example.com';
      await state.run();
      return {
        submittedSearch: state.submittedSearch,
        hasSections: document.body.innerText.includes('Active Stripe Subscriptions') && document.body.innerText.includes('Billing by Product'),
        error: state.error || ''
      };
    })()`,
    contextId,
    60_000,
  );
  if (state.error) throw new Error(state.error);
  if (!state.hasSections)
    throw new Error("Stripe billing sections did not render");
  return `search=${state.submittedSearch}`;
}

async function verifySlack(page: CdpPage, contextId: number) {
  const state = await page.waitFor<{
    channels: number;
    selected: number;
    messages: number;
    error?: string;
    text?: string;
  }>(
    `(() => {
      const state = [...document.querySelectorAll('*')]
        .map((el) => el._x_dataStack?.[0])
        .find((candidate) => candidate && Array.isArray(candidate.channels) && typeof candidate.displayMessages === 'function');
      if (!state || state.loading) return null;
      return {
        channels: state.channels.length,
        selected: state.selected.length,
        messages: state.messages.length,
        error: state.error || '',
        text: document.body.innerText
      };
    })()`,
    contextId,
    60_000,
  );
  if (state.error) throw new Error(state.error);
  if (!state.text?.includes("Analyze Feedback")) {
    throw new Error("Slack Feedback analysis UI did not render");
  }
  return `channels=${state.channels}, selected=${state.selected}, messages=${state.messages}`;
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
    spec.kind === "data" || spec.kind === "data-ui"
      ? await verifyDataBrowser(page, contextId, spec)
      : spec.kind === "gcn"
        ? await verifyGcn(page, contextId)
        : spec.kind === "qbr"
          ? await verifyQbr(page, contextId)
          : spec.kind === "cs-qbr"
            ? await verifyCsQbr(page, contextId)
            : spec.kind === "ae-pipeline"
              ? await verifyAePipeline(page, contextId)
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
                          : spec.kind === "rich-ui" || spec.kind === "explorer"
                            ? await verifyRichUi(page, contextId, spec)
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

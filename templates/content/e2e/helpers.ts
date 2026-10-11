import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  expect,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type Route,
  type TestInfo,
} from "@playwright/test";

import {
  appendFixtureInput,
  captureFixtureInput,
  type FixtureInputSnapshot,
} from "./editor-input-lineage";
import {
  SaveLineageCapture,
  type SaveLineageCheckpointName,
  type SaveLineageEvent,
  type UpdateDocumentRequestLineage,
} from "./save-lineage";

export const ACTION_HEADERS = {
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-Client-Compatibility": "content-spaces-v1",
  "X-Agent-Native-Build-Id": "development",
};

export const EDITOR = ".notion-editor.ProseMirror";

const SAVE_PATH = "/_agent-native/actions/update-document";
const SESSION_PATH = "/_agent-native/auth/session";
const EVENTS_PATH = "/_agent-native/events";
const POLL_PATH = "/_agent-native/poll";

// The text a person sees when a save did not go through cleanly. Read from
// app/i18n-data.ts; a renamed string makes these needles go quiet, so the
// lane asserts on the copy it observed rather than on its absence alone.
export const RECOVERY_UI = [
  "This page changed elsewhere. Your edits aren’t saved yet.",
  "The latest changes couldn’t be combined.",
  "Your edits couldn’t be saved. Review and try again.",
  "The saved version changed again.",
  "Unsaved page draft",
  "Choose which version to keep",
  "This draft conflicts with a newer page version.",
  "Your latest page edits could not be saved.",
  "Your edits were saved to Version History",
  "Something went wrong",
];

export async function postAction<T = Record<string, unknown>>(
  page: Page,
  name: string,
  data: Record<string, unknown>,
  headers: Record<string, string> = ACTION_HEADERS,
): Promise<T> {
  const response = await page.request.post(`/_agent-native/actions/${name}`, {
    data,
    headers,
  });
  const text = await response.text();
  expect(response.ok(), `${name} (${response.status()}): ${text}`).toBe(true);
  return JSON.parse(text) as T;
}

export async function getDocument(page: Page, id: string) {
  const response = await page.request.get(
    "/_agent-native/actions/get-document",
    { params: { id }, headers: ACTION_HEADERS },
  );
  const text = await response.text();
  expect(response.ok(), `get-document (${response.status()}): ${text}`).toBe(
    true,
  );
  return JSON.parse(text) as {
    title?: string;
    content?: string;
    revision?: string;
    bodyRevision?: number;
    contentHash?: string;
  };
}

/** The signed-in reader's recovery draft for a page, or null when none is kept. */
export async function getPreviewDraft(page: Page, documentId: string) {
  const response = await page.request.get(
    "/_agent-native/actions/get-preview-document-draft",
    { params: { documentId }, headers: ACTION_HEADERS },
  );
  const text = await response.text();
  expect(
    response.ok(),
    `get-preview-document-draft (${response.status()}): ${text}`,
  ).toBe(true);
  return (
    JSON.parse(text) as {
      draft: {
        title: string;
        content: string;
        editorSessionId?: string | null;
        editGeneration?: number | null;
      } | null;
    }
  ).draft;
}

export const PAGE_PARAGRAPHS = [
  "Alpha paragraph edited from the first tab.",
  "Bravo paragraph stays untouched.",
  "Charlie paragraph edited from the second tab.",
  "Delta paragraph stays untouched.",
];

/** The body as the editor stores it: one line per paragraph. */
export const EDITOR_BODY = PAGE_PARAGRAPHS.join("\n");

// create-document keeps blank-line Markdown as sent, so a page an agent
// wrote stays in this form until the first browser save rewrites it.
export const AGENT_MARKDOWN_BODY = PAGE_PARAGRAPHS.join("\n\n");

export async function createPage(
  page: Page,
  title: string,
  content: string,
): Promise<string> {
  const created = await postAction<{ id?: string }>(page, "create-document", {
    title,
    content,
  });
  if (!created.id) throw new Error(`create-document returned no id`);
  return created.id;
}

/** Unique words a scenario types, so each can be counted on every surface. */
export class Markers {
  readonly all: string[] = [];
  /** Words a tab deleted after typing them, which must not come back. */
  readonly removed: string[] = [];
  private readonly run = randomUUID().slice(0, 4);

  next(author: string): string {
    const marker = `zq${this.run}${author}${this.all.length + this.removed.length + 1}x`;
    this.all.push(marker);
    return marker;
  }

  remove(marker: string): void {
    const at = this.all.indexOf(marker);
    if (at < 0) throw new Error(`${marker} is not a marker`);
    this.all.splice(at, 1);
    this.removed.push(marker);
  }
}

/** Open a page and wait until its editor accepts input. */
export async function gotoEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/page/${id}`, { waitUntil: "domcontentloaded" });
  await expectEditorReady(page);
}

export async function expectEditorReady(page: Page): Promise<void> {
  await expect(page.locator(EDITOR)).toHaveAttribute(
    "contenteditable",
    "true",
    { timeout: 60_000 },
  );
}

// Headless Chromium reports every page as visible. Switching tabs changes the
// reconcile lead and triggers refetches, which is where saves used to race.
const TAB_VISIBILITY = `
globalThis.__hidden = false;
Object.defineProperty(Document.prototype, "visibilityState", {
  configurable: true,
  get() { return globalThis.__hidden ? "hidden" : "visible"; },
});
Object.defineProperty(Document.prototype, "hidden", {
  configurable: true,
  get() { return !!globalThis.__hidden; },
});
Document.prototype.hasFocus = function () { return !globalThis.__hidden; };
globalThis.__setHidden = (hidden) => {
  if (globalThis.__hidden === hidden) return;
  globalThis.__hidden = hidden;
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event(hidden ? "blur" : "focus"));
};
`;

// Reports recovery copy, toasts and editor mounts to the test as they happen,
// so a surface that appears and clears between two assertions still counts.
const OBSERVER = `
(() => {
  const needles = ${JSON.stringify(RECOVERY_UI)};
  const report = (kind, detail) => globalThis.__convergenceReport(kind, detail);
  const seen = new WeakSet();
  const showing = new Set();
  let scheduled = false;
  const scan = () => {
    scheduled = false;
    if (!document.body) return;
    for (const editor of document.querySelectorAll(${JSON.stringify(EDITOR)})) {
      if (seen.has(editor)) continue;
      seen.add(editor);
      report("editor-mount", "");
    }
    for (const toast of document.querySelectorAll("[data-sonner-toast]")) {
      if (seen.has(toast)) continue;
      seen.add(toast);
      report("toast", (toast.getAttribute("data-type") || "default") + ":" + (toast.textContent || "").trim());
    }
    // innerText, not textContent: the page embeds its message catalog in a
    // script tag, so every needle is always in textContent.
    const text = document.body.innerText || "";
    for (const needle of needles) {
      const present = text.includes(needle);
      if (present && !showing.has(needle)) report("recovery", needle);
      if (present) showing.add(needle); else showing.delete(needle);
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(scan, 100);
  };
  new MutationObserver(schedule).observe(document, {
    childList: true, subtree: true, characterData: true,
  });
  document.addEventListener("DOMContentLoaded", schedule);
})();
`;

export type SaveOutcome =
  | "written"
  | "replayed"
  | "conflict"
  | "superseded"
  | "preserved-to-history"
  | "merged-displaced"
  | "refused"
  | "aborted";

export interface TabRecord {
  label: string;
  editorMounts: number;
  loads: number;
  recovery: string[];
  errorToasts: string[];
  saveRequests: number;
  saveOutcomes: Partial<Record<SaveOutcome, number>>;
  /** Refusal codes, and the reason the server gave for a History diversion. */
  saveCodes: Record<string, number>;
  saveLineage: SaveLineageEvent[];
  saveLineageDropped: number;
  inputLineage: FixtureInputSnapshot[];
  inputLineageTruncated: boolean;
  realtimeRefusals: number;
  realtimeStreams: number;
  collabPollTimes: number[];
  saveDurationsMs: number[];
}

function emptyTab(label: string): TabRecord {
  return {
    label,
    editorMounts: 0,
    loads: 0,
    recovery: [],
    errorToasts: [],
    saveRequests: 0,
    saveOutcomes: {},
    saveCodes: {},
    saveLineage: [],
    saveLineageDropped: 0,
    inputLineage: [],
    inputLineageTruncated: false,
    realtimeRefusals: 0,
    realtimeStreams: 0,
    collabPollTimes: [],
    saveDurationsMs: [],
  };
}

function pageOf(request: Request): Page | null {
  try {
    return request.frame().page();
  } catch {
    // coercion-ok: a keepalive save sent while its page unloads has no frame;
    // it is counted under the context's detached bucket instead.
    return null;
  }
}

export async function classifySave(response: Response): Promise<{
  outcome: SaveOutcome;
  code?: string;
  bodyState: "absent" | "invalid" | "valid";
  body: Record<string, any>;
}> {
  let body: Record<string, any> = {};
  let bodyState: "absent" | "invalid" | "valid" = "invalid";
  try {
    const text = await response.text();
    if (text.length === 0) {
      bodyState = "absent";
    } else {
      try {
        const parsed: unknown = JSON.parse(text);
        body = parsed as Record<string, any>;
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        ) {
          bodyState = "valid";
        }
      } catch {
        bodyState = "invalid";
      }
    }
  } catch {
    // coercion-ok: unreadable response bodies keep the original status-based
    // outcome; the lineage records the body as invalid instead of absent.
    bodyState = "invalid";
  }
  if (!response.ok()) {
    const code = String(
      body.errorCode ?? body.code ?? body.error ?? `HTTP ${response.status()}`,
    ).slice(0, 80);
    return { outcome: "refused", code, bodyState, body };
  }
  if (body.conflict === true) return { outcome: "conflict", bodyState, body };
  if (body.superseded === true)
    return { outcome: "superseded", bodyState, body };
  if (body.preservationRequired === true)
    return {
      outcome: "preserved-to-history",
      code: `preservation:${String(body.reason ?? "unknown")}`,
      bodyState,
      body,
    };
  if (body.bodyIntentOutcome?.status === "displaced-preserved")
    return { outcome: "merged-displaced", bodyState, body };
  if (body.browserSaveAttempt?.result === "replayed")
    return { outcome: "replayed", bodyState, body };
  return { outcome: "written", bodyState, body };
}

export function isCollabPollQuery(params: URLSearchParams): boolean {
  const since = params.get("since");
  const cursor = params.has("cursor");
  if (since !== null && cursor) return false;
  if (since !== null) return Number(since) > 0;
  return cursor;
}

function refuseRealtimeStream(route: Route) {
  const url = new URL(route.request().url());
  if (url.searchParams.get("poll_live") !== "1") return route.continue();
  return route.fulfill({ status: 204, body: "" });
}

/**
 * One browser context with the tabs a scenario opens. Every tab gets the
 * visibility shim and the observer. Unless the server already refuses it, every
 * realtime stream request is answered 204, as a Netlify function answers it,
 * so both tabs fall back to the 12 s poll that beta and production run on.
 */
export class TabSet {
  readonly tabs = new Map<Page, TabRecord>();
  readonly detached = emptyTab("detached");
  private readonly pending: Promise<void>[] = [];
  private readonly sentAt = new WeakMap<Request, number>();
  private readonly saveLineage = new SaveLineageCapture();
  private readonly lineageByRequest = new WeakMap<
    Request,
    { record: TabRecord; entry: UpdateDocumentRequestLineage }
  >();
  private readonly activeSaveLineage = new Set<UpdateDocumentRequestLineage>();
  private savesInFlight = 0;

  private constructor(readonly context: BrowserContext) {}

  static async create(
    context: BrowserContext,
    { refuseRealtime = true }: { refuseRealtime?: boolean } = {},
  ): Promise<TabSet> {
    const set = new TabSet(context);
    await context.addInitScript(TAB_VISIBILITY);
    await context.addInitScript(OBSERVER);
    await context.exposeBinding(
      "__convergenceReport",
      ({ page }, kind: string, detail: string) =>
        set.observe(page, kind, detail),
    );
    if (refuseRealtime)
      await context.route(
        (url) => url.pathname === EVENTS_PATH,
        (route) => refuseRealtimeStream(route),
      );
    context.on("request", (request) => set.onRequest(request));
    context.on("response", (response) => set.onResponse(response));
    context.on("requestfailed", (request) => set.onRequestFailed(request));
    return set;
  }

  async open(label: string, id: string, page?: Page): Promise<Page> {
    const tab = page ?? (await this.context.newPage());
    this.tabs.set(tab, emptyTab(label));
    tab.on("load", () => {
      const record = this.tabs.get(tab);
      if (record) record.loads++;
    });
    await gotoEditor(tab, id);
    return tab;
  }

  record(page: Page): TabRecord {
    const record = this.tabs.get(page);
    if (!record) throw new Error("page is not one of this scenario's tabs");
    return record;
  }

  /** Make one tab the visible, focused one, as switching browser tabs does. */
  async showOnly(visible: Page): Promise<void> {
    await visible.bringToFront();
    for (const page of this.tabs.keys()) {
      if (page === visible || page.isClosed()) continue;
      await page.evaluate(() => (globalThis as any).__setHidden(true));
    }
    await visible.evaluate(() => (globalThis as any).__setHidden(false));
  }

  async showAll(): Promise<void> {
    for (const page of this.tabs.keys()) {
      if (page.isClosed()) continue;
      await page.evaluate(() => (globalThis as any).__setHidden(false));
    }
  }

  /** Wait until a tab has had `count` save answers in total. */
  async waitForSaveAnswers(page: Page, count: number): Promise<void> {
    const record = this.record(page);
    await expect
      .poll(
        async () => {
          await this.settled();
          return Object.values(record.saveOutcomes).reduce(
            (sum, value) => sum + (value ?? 0),
            0,
          );
        },
        {
          message: `${record.label} should have ${count} save answers`,
          timeout: 30_000,
        },
      )
      .toBeGreaterThanOrEqual(count);
  }

  /** Wait until an open tab's editor shows text another tab or agent wrote. */
  async waitForText(page: Page, text: string): Promise<void> {
    await expect(page.locator(EDITOR)).toContainText(text, { timeout: 30_000 });
  }

  /** Wait for every classified save response the tabs have produced. */
  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }

  captureReadback(
    checkpoint: SaveLineageCheckpointName,
    documentId: string,
    document: Awaited<ReturnType<typeof getDocument>>,
  ): void {
    this.saveLineage.captureReadback(this.detached, {
      checkpoint,
      documentId,
      content: document.content,
      contentHash: document.contentHash,
      bodyRevision: document.bodyRevision,
      revision: document.revision,
      savesInFlight: this.savesInFlight,
      pendingRequestOrders: [...this.activeSaveLineage]
        .map((entry) => entry.order)
        .sort((left, right) => left - right),
    });
  }

  /**
   * Wait until no tab has a save on the wire. Reloading or closing a tab cuts
   * off its save in flight, which is a race of its own; without this wait the
   * refresh check races whichever save the tab sent last.
   */
  async quiet(): Promise<void> {
    await expect
      .poll(() => this.savesInFlight, {
        message: "saves still in flight after the scenario ended",
        timeout: CONVERGENCE_DEADLINE_MS,
      })
      .toBe(0);
    await this.settled();
  }

  private observe(page: Page, kind: string, detail: string) {
    const record = this.tabs.get(page);
    if (!record) return;
    if (kind === "editor-mount") record.editorMounts++;
    if (kind === "fixture-input") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(detail);
      } catch {
        return;
      }
      appendFixtureInput(record, parsed);
    }
    if (kind === "recovery") record.recovery.push(detail);
    if (kind === "toast" && detail.startsWith("error:"))
      record.errorToasts.push(detail.slice("error:".length));
  }

  private onRequest(request: Request) {
    const url = new URL(request.url());
    const page = pageOf(request);
    const record = (page && this.tabs.get(page)) || this.detached;
    if (url.pathname === SAVE_PATH && request.method() === "POST") {
      record.saveRequests++;
      this.savesInFlight++;
      this.sentAt.set(request, Date.now());
      const entry = this.saveLineage.captureRequest(record, request.postData());
      if (entry) {
        this.lineageByRequest.set(request, { record, entry });
        this.activeSaveLineage.add(entry);
      }
    }
    // The shared transport sends both `since` and `cursor`, except its first
    // poll (`since=0` alone); the collaboration poll sends only one of them,
    // and never `since=0` once it holds a baseline.
    if (url.pathname === POLL_PATH && isCollabPollQuery(url.searchParams)) {
      record.collabPollTimes.push(Date.now());
    }
  }

  private onResponse(response: Response) {
    const request = response.request();
    const { pathname } = new URL(request.url());
    const page = pageOf(request);
    const record = (page && this.tabs.get(page)) || this.detached;
    if (pathname === EVENTS_PATH) {
      if (response.status() === 204) record.realtimeRefusals++;
      if (response.status() === 200) record.realtimeStreams++;
      return;
    }
    if (pathname !== SAVE_PATH || request.method() !== "POST") return;
    this.savesInFlight--;
    const sentAt = this.sentAt.get(request);
    if (sentAt !== undefined) record.saveDurationsMs.push(Date.now() - sentAt);
    const lineage = this.lineageByRequest.get(request);
    const lineageResponse = lineage
      ? this.saveLineage.beginResponse(lineage.entry, response.status())
      : undefined;
    if (lineage) this.activeSaveLineage.delete(lineage.entry);
    this.pending.push(
      classifySave(response).then(({ outcome, code, bodyState, body }) => {
        if (lineage && lineageResponse)
          this.saveLineage.finishResponse(
            lineage.entry,
            lineageResponse,
            bodyState,
            bodyState === "valid" ? body : undefined,
          );
        record.saveOutcomes[outcome] = (record.saveOutcomes[outcome] ?? 0) + 1;
        if (code) record.saveCodes[code] = (record.saveCodes[code] ?? 0) + 1;
      }),
    );
  }

  private onRequestFailed(request: Request) {
    if (
      new URL(request.url()).pathname !== SAVE_PATH ||
      request.method() !== "POST"
    )
      return;
    this.savesInFlight--;
    const page = pageOf(request);
    const record = (page && this.tabs.get(page)) || this.detached;
    record.saveOutcomes.aborted = (record.saveOutcomes.aborted ?? 0) + 1;
    const lineage = this.lineageByRequest.get(request);
    if (lineage) {
      this.activeSaveLineage.delete(lineage.entry);
      this.saveLineage.failRequest(lineage.entry);
    }
  }
}

type Held = { release: () => Promise<void> };
type HeldSave = Held & { cutOff: () => Promise<void> };

/**
 * Controls when one tab's saves reach the server and when their answers
 * reach the tab. Holding at arrival keeps a save unsent; holding the answer
 * lets the server apply it while the tab still thinks it is in flight. Both
 * make a race happen in the same order on every run.
 */
export class SaveGate {
  private mode: "pass" | "arrival" | "answer" = "pass";
  private latencyMs = 0;
  private queue: HeldSave[] = [];
  heldCount = 0;

  private constructor(private readonly page: Page) {}

  static async install(page: Page): Promise<SaveGate> {
    const gate = new SaveGate(page);
    await page.route(
      (url) => url.pathname === SAVE_PATH,
      (route) => gate.handle(route),
    );
    return gate;
  }

  setLatency(ms: number) {
    this.latencyMs = ms;
  }

  holdArrivals() {
    this.mode = "arrival";
  }

  holdAnswers() {
    this.mode = "answer";
  }

  /** Stop holding new saves; saves already held stay held until release(). */
  pass() {
    this.mode = "pass";
  }

  get queued(): number {
    return this.queue.length;
  }

  async waitForHeld(count = 1): Promise<void> {
    await expect
      .poll(() => this.queue.length, {
        message: `a save should be held at the gate`,
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(count);
  }

  /** Let every held save through, in the order the tab sent them. */
  async release(): Promise<void> {
    const held = this.queue;
    this.queue = [];
    for (const item of held) await item.release();
  }

  /**
   * Fail every held save as a dropped connection does: the tab sees each
   * request fail, whether or not the server applied it.
   */
  async cutOff(): Promise<void> {
    const held = this.queue;
    this.queue = [];
    for (const item of held) await item.cutOff();
  }

  private async handle(route: Route) {
    if (route.request().method() !== "POST") return route.continue();
    if (this.latencyMs > 0) await delay(this.latencyMs);
    if (this.mode === "arrival") {
      this.heldCount++;
      this.queue.push({
        release: () => forward(() => route.continue()),
        cutOff: () => forward(() => route.abort("aborted")),
      });
      return;
    }
    if (this.mode === "answer") {
      this.heldCount++;
      let response: Awaited<ReturnType<Route["fetch"]>>;
      try {
        response = await route.fetch();
      } catch (error) {
        if (this.page.isClosed()) return;
        throw error;
      }
      this.queue.push({
        release: () => forward(() => route.fulfill({ response })),
        cutOff: () => forward(() => route.abort("aborted")),
      });
      return;
    }
    await forward(() => route.continue());
  }
}

/**
 * Holds one kind of request until released: the session read, so a page can
 * open before it knows who is signed in, as it does once the browser's 30 s
 * session cache has expired; or an action, so a race lands in one order.
 */
export class RequestGate {
  private holding = false;
  private queue: Held[] = [];

  private constructor() {}

  static async install(page: Page, pathname: string): Promise<RequestGate> {
    const gate = new RequestGate();
    await page.route(
      (url) => url.pathname === pathname,
      (route) => {
        if (!gate.holding) return route.continue();
        gate.queue.push({ release: () => forward(() => route.continue()) });
      },
    );
    return gate;
  }

  static session(page: Page): Promise<RequestGate> {
    return RequestGate.install(page, SESSION_PATH);
  }

  static action(page: Page, name: string): Promise<RequestGate> {
    return RequestGate.install(page, `/_agent-native/actions/${name}`);
  }

  hold() {
    this.holding = true;
  }

  get queued(): number {
    return this.queue.length;
  }

  async release(): Promise<void> {
    this.holding = false;
    const held = this.queue;
    this.queue = [];
    for (const item of held) await item.release();
  }
}

async function forward(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (error) {
    // A request whose page navigated away is gone; anything else is real.
    if (!/closed|detached|Route is already handled|cancel/i.test(String(error)))
      throw error;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function typeAtParagraphEnd(
  page: Page,
  anchor: string,
  text: string,
  delayMs = 40,
): Promise<void> {
  const capture = async (phase: FixtureInputSnapshot["phase"]) => {
    const snapshot = await page.evaluate(captureFixtureInput, {
      phase,
      text,
      editor: EDITOR,
    });
    if (!snapshot) return;
    await page.evaluate((detail) => {
      const report = (
        globalThis as typeof globalThis & {
          __convergenceReport?: (kind: string, detail: string) => void;
        }
      ).__convergenceReport;
      report?.("fixture-input", detail);
    }, JSON.stringify(snapshot));
  };
  await capture("before-caret");
  await page.locator(`${EDITOR} > p`, { hasText: anchor }).first().click();
  // "End" stops at a wrapped visual line; place the caret at the true end.
  await page.evaluate(
    ({ needle, editor }) => {
      const paragraph = [...document.querySelectorAll(`${editor} > p`)].find(
        (element) => element.textContent?.includes(needle),
      );
      if (!paragraph) throw new Error(`No paragraph contains ${needle}`);
      const walker = document.createTreeWalker(
        paragraph,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) =>
            node.parentElement?.closest(
              "[class*='caret'],[class*='collaboration']",
            )
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        },
      );
      let last: Text | null = null;
      while (walker.nextNode()) last = walker.currentNode as Text;
      if (!last) throw new Error(`No text in ${needle}`);
      const range = document.createRange();
      range.setStart(last, last.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { needle: anchor, editor: EDITOR },
  );
  await page.keyboard.type(text, { delay: delayMs });
  await capture("after-input");
}

/** Select `text` in the editor and delete it with the keyboard, as a person would. */
export async function deleteEditorText(
  page: Page,
  text: string,
): Promise<void> {
  await page.evaluate(
    ({ needle, editor }) => {
      const root = document.querySelector(editor);
      if (!root) throw new Error("No editor");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const at = node.data.indexOf(needle);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      throw new Error(`The editor has no text node containing ${needle}`);
    },
    { needle: text, editor: EDITOR },
  );
  await page.keyboard.press("Backspace");
  await expect(page.locator(EDITOR)).not.toContainText(text);
}

export function countMarkers(
  text: string,
  markers: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    markers.map((marker) => [marker, text.split(marker).length - 1]),
  );
}

const MCP_TOKENS_PATH = "/_agent-native/mcp/connect/tokens";

async function activeMcpTokenIds(page: Page): Promise<Set<string>> {
  const response = await page.request.get(MCP_TOKENS_PATH);
  const text = await response.text();
  expect(response.ok(), `MCP token list (${response.status()}): ${text}`).toBe(
    true,
  );
  const { tokens } = JSON.parse(text) as {
    tokens: Array<{ id: string; revokedAt: number | null }>;
  };
  return new Set(tokens.filter((t) => !t.revokedAt).map((t) => t.id));
}

/**
 * An external agent's revisioned edit over MCP, connected through the same
 * device flow a real connector uses. `edit-document` has no HTTP action
 * route, so MCP (or A2A) is the only way an agent reaches it.
 */
export class AgentClient {
  private constructor(
    private readonly page: Page,
    private readonly connectorHeaders: Record<string, string>,
    private readonly tokenId: string | null,
  ) {}

  /** How the server identified the agent: a minted token, or loopback dev-open. */
  get identity(): "token" | "owner-email" {
    return this.connectorHeaders.Authorization ? "token" : "owner-email";
  }

  static async connect(page: Page): Promise<AgentClient> {
    const before = await activeMcpTokenIds(page);
    const start = await page.request.post(
      "/_agent-native/mcp/connect/device/start",
      { data: {} },
    );
    expect(start.ok(), `MCP device start: ${await start.text()}`).toBe(true);
    const { device_code, user_code } = (await start.json()) as {
      device_code: string;
      user_code: string;
    };
    const authorize = await page.request.post(
      "/_agent-native/mcp/connect/device/authorize",
      { data: { user_code } },
    );
    expect(
      authorize.ok(),
      `MCP device authorize: ${await authorize.text()}`,
    ).toBe(true);
    const poll = await page.request.post(
      "/_agent-native/mcp/connect/device/poll",
      { data: { device_code } },
    );
    const polled = (await poll.json()) as {
      status?: string;
      mcpServerEntry?: { headers?: Record<string, string> };
    };
    expect(polled.status, JSON.stringify(polled)).toBe("approved");
    // A connector sends exactly the headers the server hands it: a bearer
    // token, or the owner header a loopback server without A2A_SECRET uses.
    const headers = polled.mcpServerEntry?.headers ?? {};
    expect(Object.keys(headers), "MCP connector identity headers").not.toEqual(
      [],
    );
    if (!headers.Authorization) return new AgentClient(page, headers, null);
    // The token list names rows, not tokens; the one new row is this one.
    const minted = [...(await activeMcpTokenIds(page))].filter(
      (id) => !before.has(id),
    );
    try {
      expect(
        minted,
        "exactly one MCP token minted by this connection",
      ).toHaveLength(1);
    } catch (error) {
      // The poll already minted a live token; don't leave it behind.
      for (const id of minted)
        await page.request.post(`${MCP_TOKENS_PATH}/revoke`, { data: { id } });
      throw error;
    }
    return new AgentClient(page, headers, minted[0]);
  }

  /** Connect, apply one edit, and revoke the connection even if the edit fails. */
  static async editOnce(
    page: Page,
    id: string,
    find: string,
    replace: string,
  ): Promise<AgentClient["identity"]> {
    const agent = await AgentClient.connect(page);
    try {
      await agent.edit(id, find, replace);
    } finally {
      await agent.disconnect();
    }
    return agent.identity;
  }

  /** Revoke the token this connection minted, so scheduled runs leave none behind. */
  async disconnect(): Promise<void> {
    if (!this.tokenId) return;
    const response = await this.page.request.post(`${MCP_TOKENS_PATH}/revoke`, {
      data: { id: this.tokenId },
    });
    const text = await response.text();
    expect(response.ok(), `MCP token revoke: ${text}`).toBe(true);
    expect(
      (await activeMcpTokenIds(this.page)).has(this.tokenId),
      "the MCP token is still active after revoke",
    ).toBe(false);
  }

  /** Apply one find/replace and fail unless the server reports it applied. */
  async edit(id: string, find: string, replace: string): Promise<void> {
    const { revision } = await getDocument(this.page, id);
    const response = await this.page.request.post("/_agent-native/mcp", {
      headers: {
        ...this.connectorHeaders,
        Accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "edit-document",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "edit-document",
          arguments: {
            id,
            baseRevision: revision,
            idempotencyKey: `${id}-${find}-${Date.now()}`,
            edits: [{ find, replace }],
          },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientInfo": {
              name: "content-convergence-e2e",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      },
    });
    const raw = await response.text();
    expect(response.ok(), `edit-document over MCP: ${raw}`).toBe(true);
    const payload = raw.trimStart().startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(
          raw
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length))
            .join(""),
        );
    expect(payload.result?.isError, `edit-document over MCP: ${raw}`).not.toBe(
      true,
    );
    const text = payload.result?.content?.[0]?.text;
    expect(typeof text, `edit-document over MCP returned no text: ${raw}`).toBe(
      "string",
    );
    const receipt = JSON.parse(text) as { applied?: number; total?: number };
    expect(
      receipt.applied,
      `edit-document applied ${receipt.applied} of ${receipt.total}: ${text}`,
    ).toBe(receipt.total);
  }
}

export interface IntegrityObservation {
  at: "deadline" | "refresh" | "reopened-alone";
  surface: string;
  lost: string[];
  duplicated: string[];
  /** Words a tab deleted that came back. */
  resurrected: string[];
}

function judge(
  at: IntegrityObservation["at"],
  surface: string,
  text: string,
  markers: readonly string[],
  removed: readonly string[],
): IntegrityObservation {
  const counts = countMarkers(text, markers);
  const removedCounts = countMarkers(text, removed);
  return {
    at,
    surface,
    lost: Object.keys(counts).filter((marker) => counts[marker] === 0),
    duplicated: Object.keys(counts).filter((marker) => counts[marker] > 1),
    resurrected: Object.keys(removedCounts).filter(
      (marker) => removedCounts[marker] > 0,
    ),
  };
}

async function editorText(page: Page): Promise<string> {
  return page.locator(EDITOR).innerText();
}

const CONVERGENCE_DEADLINE_MS = 45_000;

/**
 * The integrity gate: every marker appears exactly once in the saved page
 * and in each open tab's editor, and no deleted marker appears at all, after
 * the tabs have had time to converge, again after a refresh, and again in a
 * tab opened alone, where no live copy can stand in for a lost save. History
 * and recovery views do not count.
 */
export async function observeIntegrity(
  tabs: TabSet,
  reader: Page,
  id: string,
  markers: Markers,
): Promise<IntegrityObservation[]> {
  const observations: IntegrityObservation[] = [];
  const open = [...tabs.tabs.keys()].filter((page) => !page.isClosed());

  const settle = async (at: IntegrityObservation["at"], pages: Page[]) => {
    const deadline = Date.now() + CONVERGENCE_DEADLINE_MS;
    let round: IntegrityObservation[] = [];
    let lastDocument: Awaited<ReturnType<typeof getDocument>> | undefined;
    do {
      lastDocument = await getDocument(reader, id);
      tabs.captureReadback(at, id, lastDocument);
      round = [
        judge(
          at,
          "sql",
          lastDocument.content ?? "",
          markers.all,
          markers.removed,
        ),
      ];
      for (const page of pages)
        round.push(
          judge(
            at,
            tabs.record(page).label,
            await editorText(page),
            markers.all,
            markers.removed,
          ),
        );
      if (round.every((entry) => !integrityProblem(entry))) break;
      await delay(1_000);
    } while (Date.now() < deadline);
    observations.push(...round);
  };

  // A hidden tab may defer remote updates; the gate asks what a person sees
  // after looking at each tab, not what a background tab has painted.
  await tabs.showAll();
  await tabs.settled();
  await settle("deadline", open);

  await tabs.quiet();
  tabs.captureReadback("before-refresh", id, await getDocument(reader, id));
  for (const page of open) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectEditorReady(page);
  }
  await settle("refresh", open);

  await tabs.quiet();
  tabs.captureReadback("before-close", id, await getDocument(reader, id));
  for (const page of open) await page.close();
  const alone = await tabs.open("alone", id);
  await settle("reopened-alone", [alone]);
  await alone.close();
  return observations;
}

export interface ScenarioRecord {
  scenario: string;
  /** Playwright tags, with the `@`; `@known-loss` marks a non-blocking scenario. */
  tags: string[];
  notes: Record<string, unknown>;
  build: string;
  authoredEdits: number;
  markers: number;
  durationMs: number;
  integrity: IntegrityObservation[];
  tabs: TabRecord[];
}

/** Append one scenario's counts to the lane's JSON report. */
export function writeScenarioRecord(
  testInfo: TestInfo,
  record: ScenarioRecord,
): void {
  const file =
    process.env.CONTENT_CONVERGENCE_REPORT ??
    path.join(testInfo.project.outputDir, "convergence.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function integrityProblem(entry: IntegrityObservation): boolean {
  return Boolean(
    entry.lost.length || entry.duplicated.length || entry.resurrected.length,
  );
}

export function integrityFailures(record: ScenarioRecord): string[] {
  return record.integrity
    .filter(integrityProblem)
    .map(
      (entry) =>
        `${entry.at} ${entry.surface}: lost ${JSON.stringify(entry.lost)}, duplicated ${JSON.stringify(entry.duplicated)}, deleted but back ${JSON.stringify(entry.resurrected)}`,
    );
}

const HISTORY_OUTCOMES = ["preserved-to-history", "merged-displaced"] as const;

/** Recovery copy, error toasts and saves sent to History, none of which a clean save shows. */
export function noiseFailures(tabs: readonly TabRecord[]): string[] {
  return tabs.flatMap((tab) => [
    ...tab.recovery.map((notice) => `${tab.label} showed "${notice}"`),
    ...tab.errorToasts.map((toast) => `${tab.label} toasted "${toast}"`),
    ...HISTORY_OUTCOMES.filter((outcome) => tab.saveOutcomes[outcome]).map(
      (outcome) =>
        `${tab.label} had ${tab.saveOutcomes[outcome]} saves ${outcome}`,
    ),
  ]);
}

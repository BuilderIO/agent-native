import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, basename, resolve } from "node:path";

import {
  test as base,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { connectToQaBrowser } from "../qa-browser.js";
import { readDescriptor } from "./descriptor";

export { expect };

export type DailyServer = { base: string; fake: string; cookie: string };

type ConsoleEntry = { type: string; text: string; url?: string };
type KeyRecord = { key: string; t: number; fb: number | null };

/** Visible text that only an error state shows. */
export const ERROR_TEXT =
  /Something went wrong|Application error|Unexpected (error|token)|Cannot read properties|is not a function|Action [a-z-]+ failed|Page not found|There was an error loading|\b(?:Internal Server Error|HTTP 5\d\d)\b/i;

/** Console noise that is not a product failure a person sees. Keep this list short and exact. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/,
  /\[vite\]/,
  // Chromium logs these for the dev server's optimize-dep warmup only.
  /Outdated Optimize Dep/,
];

export class Daily {
  readonly consoleErrors: ConsoleEntry[] = [];
  readonly failedResponses: Array<{ status: number; url: string }> = [];
  readonly steps: string[] = [];
  readonly createdProjects = new Set<string>();
  readonly createdConnections = new Set<string>();
  expectedErrorText = false;
  private readonly pendingCreates = new Set<Promise<unknown>>();
  private closing = false;
  private checkedConsole = 0;
  private checkedResponses = 0;
  private docId = "";
  /** Failed responses a test expects (for example a 4xx the test provoked on purpose). */
  allowResponse: RegExp[] = [];

  constructor(
    readonly page: Page,
    readonly context: BrowserContext,
    readonly server: DailyServer,
  ) {}

  // ---------- fake provider + app control ----------
  /** Switch the fake provider's scenario: `{ bigquery: "empty" | "error" | "denied" | "slow", hubspot: ... }`. */
  async scenario(patch: Record<string, unknown>) {
    const r = await fetch(`${this.server.fake}__control/scenario`, {
      method: "POST",
      body: JSON.stringify(patch),
    });
    expect(r.ok).toBe(true);
  }
  /** A fresh service-account JSON key that the fake accepts. */
  async serviceAccountKey(): Promise<string> {
    const r = await fetch(`${this.server.fake}__control/key`, {
      method: "POST",
      body: "{}",
    });
    return JSON.stringify(await r.json(), null, 2);
  }
  /** Requests the app sent to the fake provider since the last reset. */
  async providerCalls(): Promise<
    Array<{ host: string; method: string; path: string }>
  > {
    return (await fetch(`${this.server.fake}__control/calls`)).json();
  }
  /** Call an app action as the signed-in user (setup and cleanup only; the UI is what tests check). */
  action<T = unknown>(
    name: string,
    body: Record<string, unknown> = {},
    method: "GET" | "POST" = "POST",
  ): Promise<T> {
    if (name === "create-project" && this.closing)
      return Promise.reject(new Error("Daily fixture is closing"));
    const operation = this.performAction<T>(name, body, method);
    if (name === "create-project") {
      this.pendingCreates.add(operation);
      void operation.then(
        () => this.pendingCreates.delete(operation),
        () => this.pendingCreates.delete(operation),
      );
    }
    return operation;
  }

  private async performAction<T>(
    name: string,
    body: Record<string, unknown>,
    method: "GET" | "POST",
  ): Promise<T> {
    const url = `${this.server.base}/_agent-native/actions/${name}`;
    const response =
      method === "GET"
        ? await this.context.request.get(url, {
            params: Object.fromEntries(
              Object.entries(body).map(([k, v]) => [
                k,
                typeof v === "string" ? v : JSON.stringify(v),
              ]),
            ),
          })
        : await this.context.request.post(url, { data: body });
    const text = await response.text();
    expect(
      response.ok(),
      `action ${name} → ${response.status()}: ${text.slice(0, 400)}`,
    ).toBe(true);
    try {
      const result = JSON.parse(text);
      if (name === "create-project") {
        const id = result.id;
        if (typeof id !== "string" || !id)
          throw new Error("create-project returned no project ID");
        this.createdProjects.add(id);
      }
      if (name === "delete-project")
        this.createdProjects.delete(String(body.projectId));
      return result as T;
    } catch (error) {
      throw new Error(`Action ${name} returned unreadable JSON`, {
        cause: error,
      });
    }
  }
  /** A fresh project with a unique title; returns its id. */
  async createProject(
    title = uniqueName("Daily project"),
  ): Promise<{ id: string; title: string }> {
    const result = await this.action<Record<string, unknown>>(
      "create-project",
      { title },
    );
    const project = (result.project ?? result) as Record<string, unknown>;
    const id = String(project.id ?? project.projectId ?? "");
    expect(
      id,
      `create-project returned ${JSON.stringify(result).slice(0, 300)}`,
    ).not.toBe("");
    return { id, title };
  }

  async cleanup() {
    this.closing = true;
    const settled = await Promise.allSettled(this.pendingCreates);
    const errors: unknown[] = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    };
    await attempt(() => this.page.close());
    for (const name of this.createdConnections) {
      await attempt(async () => {
        const { deleteConnections } = await import("./setup.helpers");
        await deleteConnections(this, [name]);
      });
    }
    for (const id of this.createdProjects)
      await attempt(() => this.cleanupProject(id));
    if (errors.length)
      throw new AggregateError(errors, "Daily cleanup failed", {
        cause: errors[0],
      });
  }

  async cleanupProject(projectId: string) {
    const response = await this.context.request.get(
      `${this.server.base}/_agent-native/actions/get-project`,
      { params: { projectId } },
    );
    if (response.status() === 404) {
      this.createdProjects.delete(projectId);
      return;
    }
    expect(response.ok(), `cleanup read ${projectId}`).toBe(true);
    await this.action("trash-project", { projectId });
    await this.action("delete-project", { projectId });
  }

  async cleanupAction(name: string, body: Record<string, unknown>) {
    const response = await this.context.request.post(
      `${this.server.base}/_agent-native/actions/${name}`,
      { data: body },
    );
    const result = await response.json();
    if (
      response.status() === 404 &&
      [
        "project_not_found",
        "thread_not_found",
        "collection_not_found",
      ].includes(result.errorCode)
    )
      return { status: "absent" as const };
    expect(response.ok(), `cleanup ${name}: ${JSON.stringify(result)}`).toBe(
      true,
    );
    return { status: "removed" as const };
  }

  async documentId(): Promise<string> {
    return this.page.evaluate(
      () => (window as unknown as { __daily: { doc: string } }).__daily.doc,
    );
  }
  async open(path = "/home") {
    this.steps.push(`open ${path}`);
    await this.page.goto(`${this.server.base}${path}`, {
      waitUntil: "domcontentloaded",
    });
    await this.page.waitForLoadState("domcontentloaded");
    if (path === "/")
      await this.page.waitForURL(/\/home$/, { waitUntil: "domcontentloaded" });
    this.docId = await this.documentId();
  }
  /** A full reload the test asks for; the no-reload invariant then tracks the new document. */
  async reload() {
    this.steps.push("reload");
    await this.page.reload();
    this.docId = await this.documentId();
  }
  async back() {
    this.steps.push("back");
    await this.page.goBack();
  }
  async forward() {
    this.steps.push("forward");
    await this.page.goForward();
  }
  path(): string {
    const u = new URL(this.page.url());
    return u.pathname + u.search;
  }

  /**
   * Press a key the way a person does and require some visible change (any DOM mutation)
   * within `within` ms of the keydown, measured in the page. `feedback: false` for keys that
   * legitimately change nothing.
   */
  async press(
    key: string,
    options: { feedback?: boolean; within?: number } = {},
  ) {
    this.steps.push(`press ${key}`);
    const before = await this.page.evaluate(
      () =>
        (window as unknown as { __daily: { keys: (KeyRecord | undefined)[] } })
          .__daily.keys.length,
    );
    await this.page.keyboard.press(key);
    if (options.feedback === false) return null;
    const within = options.within ?? 400;
    const handle = await this.page.waitForFunction(
      ({ index, limit }) => {
        const record = (
          window as unknown as { __daily: { keys: (KeyRecord | undefined)[] } }
        ).__daily.keys[index];
        if (!record) return null;
        if (record.fb !== null) return { latency: record.fb };
        return performance.now() - record.t > limit + 600
          ? { latency: -1 }
          : null;
      },
      { index: before, limit: within },
      { timeout: 5_000, polling: 50 },
    );
    const { latency } = (await handle.jsonValue()) as { latency: number };
    expect(
      latency,
      `visible feedback for "${key}" (${this.steps.join(" → ")}): ${latency < 0 ? "no change" : `${Math.round(latency)} ms`}; limit ${within} ms`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      latency,
      `visible feedback for "${key}" took ${Math.round(latency)} ms`,
    ).toBeLessThanOrEqual(within);
    return latency;
  }

  /** Click and require a visible change within `within` ms of the pointerdown, measured in the page. */
  async click(
    target: Locator,
    options: { within?: number; label?: string } = {},
  ) {
    this.steps.push(`click ${options.label ?? target.toString()}`);
    await target.waitFor({ state: "visible" });
    const before = await this.page.evaluate(
      () =>
        (window as unknown as { __daily: { keys: (KeyRecord | undefined)[] } })
          .__daily.keys.length,
    );
    await target.click();
    expect(await this.documentId(), "click preserves the document").toBe(
      this.docId,
    );
    const within = options.within ?? 400;
    const handle = await this.page.waitForFunction(
      ({ index, limit }) => {
        const record = (
          window as unknown as { __daily: { keys: (KeyRecord | undefined)[] } }
        ).__daily.keys[index];
        if (!record) return null;
        if (record.fb !== null) return { latency: record.fb };
        return performance.now() - record.t > limit + 600
          ? { latency: -1 }
          : null;
      },
      { index: before, limit: within },
      { timeout: 5_000, polling: 50 },
    );
    const { latency } = (await handle.jsonValue()) as { latency: number };
    expect(
      latency,
      `visible feedback for click (${this.steps.join(" → ")}): ${latency < 0 ? "no change" : `${Math.round(latency)} ms`}; limit ${within} ms`,
    ).toBeGreaterThanOrEqual(0);
    expect(latency).toBeLessThanOrEqual(within);
  }

  async type(text: string) {
    this.steps.push(`type "${text}"`);
    await this.page.keyboard.type(text);
  }

  /**
   * Holds after every step: no full page reload, no console/page error and no unexpected failed
   * request since the last check, no error text on screen, focus never stranded on a hidden
   * element, and (when given) the URL matches the screen.
   */
  async check(
    options: {
      url?: RegExp;
      allowErrorText?: boolean;
      focus?: Locator | "body-ok";
    } = {},
  ) {
    if (options.allowErrorText) this.expectedErrorText = true;
    const where = `after ${this.steps.at(-1) ?? "start"} (${this.steps.join(" → ")})`;
    expect(await this.documentId(), `full page reload ${where}`).toBe(
      this.docId,
    );
    const fresh = this.consoleErrors
      .slice(this.checkedConsole)
      .filter(
        (entry) =>
          !(
            /Failed to load resource:|net::ERR_/.test(entry.text) &&
            entry.url &&
            this.allowResponse.some((pattern) => pattern.test(entry.url ?? ""))
          ),
      );
    this.checkedConsole = this.consoleErrors.length;
    expect(
      fresh.map((e) => `${e.type}: ${e.text.slice(0, 300)}`),
      `console errors ${where}`,
    ).toEqual([]);
    const failed = this.failedResponses
      .slice(this.checkedResponses)
      .filter((r) => !this.allowResponse.some((p) => p.test(r.url)));
    this.checkedResponses = this.failedResponses.length;
    expect(
      failed.map((r) => `${r.status} ${r.url}`),
      `failed requests ${where}`,
    ).toEqual([]);
    if (!options.allowErrorText) {
      const text = await this.page.locator("body").innerText();
      const match = ERROR_TEXT.exec(text);
      expect(match?.[0] ?? null, `error text on screen ${where}`).toBeNull();
    }
    if (options.url)
      await expect(this.page, `URL ${where}`).toHaveURL(options.url);
    const focus = await this.page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return "body";
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden"
        ? "visible"
        : `hidden <${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.id}>`;
    });
    expect(
      focus.startsWith("hidden"),
      `focus stranded on a hidden element ${where}: ${focus}`,
    ).toBe(false);
    if (options.focus && options.focus !== "body-ok")
      await expect(options.focus, `focus ${where}`).toBeFocused();
  }

  dialog() {
    return this.page.getByRole("dialog");
  }
  menu() {
    return this.page.getByRole("menu");
  }
  toast(text: string | RegExp) {
    return this.page
      .locator("[data-sonner-toast], [role=status], [role=alert]")
      .filter({ hasText: text });
  }
}

let counter = 0;
export function uniqueName(prefix: string) {
  counter += 1;
  return `${prefix} ${process.pid.toString(36)}${counter}`;
}

// Installed before any page script: a document id (changes only on a full load) and a monitor
// that records each keydown/pointerdown and when the DOM first changed after it.
function installMonitor() {
  const w = window as unknown as {
    __daily: { doc: string; keys: KeyRecord[] };
  };
  w.__daily = { doc: Math.random().toString(36).slice(2), keys: [] };
  const pending: KeyRecord[] = [];
  const mark = () => {
    const now = performance.now();
    while (pending.length) {
      const r = pending.shift();
      if (r) r.fb = now - r.t;
    }
  };
  const start = () => {
    new MutationObserver(mark).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  };
  if (document.querySelector("html")) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
  const record = (key: string) => {
    const r = { key, t: performance.now(), fb: null as number | null };
    w.__daily.keys.push(r);
    pending.push(r);
  };
  window.addEventListener("keydown", (e) => record(e.key), true);
  window.addEventListener("pointerdown", () => record("pointer"), true);
  // Focus and scroll changes count as visible feedback too.
  window.addEventListener("focusin", mark, true);
}

function cookiesFor(server: DailyServer) {
  return server.cookie
    .split("; ")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      return {
        name: pair.slice(0, i),
        value: pair.slice(i + 1),
        url: server.base,
      };
    });
}

export const test = base.extend<
  { daily: Daily },
  { server: DailyServer; dailyContext: BrowserContext; dailyTouch: boolean }
>({
  browser: [
    async ({}, provide) => {
      const browser = await connectToQaBrowser();
      try {
        await provide(browser);
      } finally {
        await browser.close();
      }
    },
    { scope: "worker" },
  ],
  dailyTouch: [false, { scope: "worker", option: true }],
  dailyContext: [
    async ({ browser, server, dailyTouch }, provide) => {
      const context = await browser.newContext({
        serviceWorkers: "block",
        proxy: { server: server.fake, bypass: "<-loopback>" },
        viewport: { width: 1440, height: 900 },
        hasTouch: dailyTouch,
      });
      try {
        await context.addCookies(cookiesFor(server));
        await context.addInitScript(installMonitor);
        await provide(context);
      } finally {
        await context.close();
      }
    },
    { scope: "worker" },
  ],
  context: async ({ dailyContext }, provide) => {
    await provide(dailyContext);
    await dailyContext.unrouteAll({ behavior: "ignoreErrors" });
    await dailyContext.clearPermissions();
    await dailyContext.setOffline(false);
  },
  server: [
    async ({}, provide) => {
      const descriptor = readDescriptor();
      const server = {
        base: descriptor.base,
        fake: descriptor.fake,
        cookie: readFileSync(descriptor.cookiePath, "utf8"),
      };
      await provide(server);
    },
    { scope: "worker", timeout: 600_000 },
  ],
  daily: async ({ page, context, server }, provide, info) => {
    const sharedState =
      /^(setup|provider)\.spec\.ts$/.test(basename(info.file)) ||
      /^(NOTEBOOK-(01|07|14|15)|OBJECTS-(36|37)|KEYS-90|SETTINGS-12|STATES-(06|07|08|09|17|20)|VIEWS-(12|13)|NAV-15)\b/.test(
        info.title,
      );
    const marker = readDescriptor().warmFile;
    const lock = resolve(dirname(marker), "provider-lock");
    const started = Date.now();
    const timeout = info.timeout;
    info.setTimeout(timeout + 180_000);
    let locked = false;
    const daily = new Daily(page, context, server);
    const errors: unknown[] = [];
    try {
      if (sharedState) {
        for (;;) {
          try {
            await mkdir(lock);
            locked = true;
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            if (Date.now() - started > 150_000)
              throw new Error("Daily shared provider lock timed out");
            await new Promise((done) => setTimeout(done, 25));
          }
        }
        const reset = await fetch(`${server.fake}__control/reset`, {
          method: "POST",
          body: "{}",
        });
        expect(reset.ok, "fake provider reset").toBe(true);
      }
      info.setTimeout(timeout + Date.now() - started);
      await context.addCookies(cookiesFor(server));
      await page.addInitScript((caseId) => {
        if (sessionStorage.getItem("__analyticsDailyCase") === caseId) return;
        localStorage.clear();
        sessionStorage.clear();
        sessionStorage.setItem("__analyticsDailyCase", caseId);
      }, info.testId);
      page.on("console", (m) => {
        if (
          (m.type() === "error" || m.type() === "assert") &&
          !IGNORED_CONSOLE.some((p) => p.test(m.text()))
        )
          daily.consoleErrors.push({
            type: m.type(),
            text: m.text(),
            url: m.location().url,
          });
      });
      page.on("pageerror", (e) =>
        daily.consoleErrors.push({ type: "pageerror", text: e.message }),
      );
      page.on("response", (r) => {
        if (r.status() >= 400 && r.url().startsWith(server.base))
          daily.failedResponses.push({ status: r.status(), url: r.url() });
      });
      await provide(daily);
      if (info.status === "passed")
        await daily.check({ allowErrorText: daily.expectedErrorText });
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        if (
          info.status !== info.expectedStatus ||
          daily.consoleErrors.length > 0 ||
          daily.failedResponses.length > 0
        )
          await info.attach("daily-observations", {
            body: JSON.stringify({
              steps: daily.steps,
              console: daily.consoleErrors,
              responses: daily.failedResponses,
            }),
            contentType: "application/json",
          });
      } catch (error) {
        errors.push(error);
      }
      try {
        await daily.cleanup();
      } catch (error) {
        errors.push(error);
      }
      if (locked) {
        try {
          await rm(lock, { recursive: true });
        } catch (error) {
          errors.push(error);
        }
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Daily fixture failed", {
        cause: errors[0],
      });
  },
});

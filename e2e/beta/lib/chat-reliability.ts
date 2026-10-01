/**
 * Browser half of the `[chat-reliability]` specs: one session per test, with
 * its own signed-in context, thread, and evidence.
 *
 * Every assertion is about what a user can see or what the server will tell
 * any client. Nothing here reads internal state, so a failure message can only
 * say something a person could verify by opening the thread.
 */
import {
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
} from "@playwright/test";

import { signedInContext } from "./authed";
import { watchChatRequests } from "./chat";
import {
  composerHoldsPrompt,
  describePersisted,
  describeState,
  INTERNAL_LEAK_PATTERNS,
  inspectActiveRun,
  inspectPersistedThread,
  isIdle,
  isTurnPost,
  parseJson,
  RELIABILITY_TAG,
  RUN_FAILURE_TEXT,
  scanVisibleText,
  summarizeTraffic,
  tail,
  threadDeepLink,
  threadIdFromTraffic,
  threadIdFromUrl,
  type ChatState,
  type SerializablePattern,
  type StateRead,
  type TrafficEntry,
} from "./chat-reliability-core";
import { authenticatedEntryPath, originFor, type BetaSite } from "./fleet";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./test-traffic";

const API_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
  "X-Agent-Native-CSRF": "1",
};

const AGENT_CHAT_ROUTE = "/_agent-native/agent-chat";
// The chat's composer carries the `agentkit-composer` class; every other prompt
// box in an app (dialogs, popovers) is a different composer without it.
const COMPOSER_ROOT = '.agentkit-composer[data-agent-composer-slot="root"]';
const SIDEBAR_ROOT = `.agent-sidebar-panel[data-agent-sidebar-state="open"] ${COMPOSER_ROOT}:visible`;
const ANY_ROOT = `${COMPOSER_ROOT}:visible`;
export const WATCH_STORAGE_KEY = "__chatReliabilityHits";

interface WatchHit {
  label: string;
  excerpt: string;
  atMs: number;
}

/**
 * Runs in the page, before its scripts, on every navigation. Records the first
 * time each forbidden string becomes visible, so an error card that flashes for
 * 100ms between two polls is still caught. Hits live in sessionStorage so a
 * reload does not erase them. It must stay self-contained: Playwright
 * serializes it into the page.
 */
export function installTextWatch(config: {
  key: string;
  needles: string[];
  patterns: SerializablePattern[];
}): void {
  if (window.top !== window) return;
  const startedAt = Date.now();
  let hits: WatchHit[] = [];
  try {
    hits = JSON.parse(
      window.sessionStorage.getItem(config.key) ?? "[]",
    ) as WatchHit[];
  } catch {
    // coercion-ok: sessionStorage may be blocked; the final text sweep still runs.
    hits = [];
  }
  const seen = new Set(hits.map((hit) => hit.label));
  const record = (
    label: string,
    text: string,
    index: number,
    length: number,
  ) => {
    if (seen.has(label)) return;
    seen.add(label);
    hits.push({
      label,
      atMs: Date.now() - startedAt,
      excerpt: text
        .slice(Math.max(0, index - 80), index + length + 120)
        .replace(/\s+/g, " ")
        .trim(),
    });
    try {
      window.sessionStorage.setItem(config.key, JSON.stringify(hits));
    } catch {
      // coercion-ok: sessionStorage may be blocked; the final text sweep still runs.
    }
  };
  const check = (text: string) => {
    if (!text) return;
    const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
    const lower = sample.toLowerCase();
    for (const needle of config.needles) {
      const index = lower.indexOf(needle.toLowerCase());
      if (index >= 0) record(needle, sample, index, needle.length);
    }
    for (const pattern of config.patterns) {
      const match = new RegExp(pattern.source, pattern.flags).exec(sample);
      if (match) record(pattern.label, sample, match.index, match[0].length);
    }
  };
  // The visible page text, settled: catches text built from several nodes.
  const scan = () => check(document.body ? document.body.innerText : "");
  let timer: number | undefined;
  const schedule = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      scan();
    }, 120);
  };
  // Each inserted node, as it is inserted: a card removed again within the
  // debounce above would otherwise never be seen. Elements are read as visible
  // text, not textContent, which would include inline scripts and styles.
  const skipped = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const nodeText = (node: Node): string => {
    if (node.nodeType === 1) {
      return skipped.has((node as Element).tagName)
        ? ""
        : (node as HTMLElement).innerText;
    }
    return skipped.has(node.parentElement?.tagName ?? "")
      ? ""
      : (node.textContent ?? "");
  };
  new MutationObserver((records) => {
    for (const mutation of records) {
      if (mutation.type === "characterData") {
        check(nodeText(mutation.target));
        continue;
      }
      mutation.addedNodes.forEach((node) => check(nodeText(node)));
    }
    schedule();
  }).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  document.addEventListener("DOMContentLoaded", schedule);
}

export async function readChatState(page: Page): Promise<StateRead> {
  try {
    const state = await page.evaluate((): ChatState => {
      const visible = (element: Element): boolean => {
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
        );
      };
      const all = <T extends Element>(scope: ParentNode, selector: string) =>
        Array.from(scope.querySelectorAll<T>(selector));
      const text = (element: Element) =>
        ((element as HTMLElement).innerText ?? "").trim();
      const roots = all<HTMLElement>(
        document,
        '.agentkit-composer[data-agent-composer-slot="root"]',
      ).filter(visible);
      const root =
        roots.find((candidate) => candidate.closest(".agent-sidebar-panel")) ??
        roots[0] ??
        null;
      const scope: ParentNode =
        root?.closest(".agent-sidebar-panel") ?? document;
      const slot = (name: string) =>
        root
          ? all<HTMLElement>(
              root,
              `[data-agent-composer-slot="${name}"]`,
            ).filter(visible)
          : [];
      const input = slot("editor-input")[0];
      const send = slot("send-button")[0] as HTMLButtonElement | undefined;
      return {
        url: window.location.href,
        composerFound: Boolean(root && input),
        composerText: input ? text(input) : "",
        stopVisible: slot("stop-button").length > 0,
        sendVisible: Boolean(send),
        sendEnabled: Boolean(
          send &&
          !send.disabled &&
          send.getAttribute("aria-disabled") !== "true",
        ),
        currentActivity: all<HTMLElement>(
          scope,
          "[data-agentkit-current-activity]",
        )
          .filter(visible)
          .map(text),
        messages: all<HTMLElement>(scope, "article.agentkit-message").map(
          (element) => ({
            role: element.dataset.role ?? "",
            id: element.dataset.messageId ?? null,
            busy: element.getAttribute("aria-busy") === "true",
            text: text(element),
          }),
        ),
        errorCards: all<HTMLElement>(
          scope,
          ".agentkit-run-failure, .agentkit-error, [data-error-code]",
        )
          .filter(visible)
          .map((element) => ({
            code: element.getAttribute("data-error-code"),
            text: text(element).slice(0, 300),
          })),
        alerts: all<HTMLElement>(document, '[role="alert"]')
          .filter(visible)
          .map((element) => text(element).slice(0, 300))
          .filter(Boolean)
          .slice(0, 8),
        bodyText: (document.body?.innerText ?? "").slice(0, 400_000),
      };
    });
    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      reason: (error instanceof Error ? error.message : String(error)).split(
        "\n",
      )[0],
    };
  }
}

export async function readWatchHits(
  page: Page,
): Promise<{ ok: true; hits: WatchHit[] } | { ok: false; reason: string }> {
  try {
    const hits = await page.evaluate(
      (key) =>
        JSON.parse(window.sessionStorage.getItem(key) ?? "[]") as WatchHit[],
      WATCH_STORAGE_KEY,
    );
    return { ok: true, hits };
  } catch (error) {
    return {
      ok: false,
      reason: (error instanceof Error ? error.message : String(error)).split(
        "\n",
      )[0],
    };
  }
}

export class TrafficRecorder {
  readonly entries: TrafficEntry[] = [];
  private readonly byRequest = new Map<Request, TrafficEntry>();

  constructor(private readonly startedAt: number) {}

  attach(page: Page): void {
    page.on("request", (request) => {
      if (!URL.canParse(request.url())) return;
      const url = new URL(request.url());
      if (!url.pathname.includes(AGENT_CHAT_ROUTE)) return;
      const entry: TrafficEntry = {
        atMs: Date.now() - this.startedAt,
        method: request.method(),
        path: url.pathname,
        query: url.search,
        status: null,
      };
      if (isTurnPost(entry)) {
        const body = parseJson(request.postData() ?? "");
        const threadId =
          body.ok && body.value && typeof body.value === "object"
            ? (body.value as { threadId?: unknown }).threadId
            : undefined;
        if (typeof threadId === "string" && threadId) {
          entry.threadId = threadId;
        }
      }
      this.entries.push(entry);
      this.byRequest.set(request, entry);
    });
    page.on("response", (response) => {
      const entry = this.byRequest.get(response.request());
      if (entry) entry.status = response.status();
    });
    page.on("requestfailed", (request) => {
      const entry = this.byRequest.get(request);
      if (entry) entry.failure = request.failure()?.errorText ?? "failed";
    });
  }

  /** Turn POSTs the server refused because a run already held the thread. */
  conflicts(): TrafficEntry[] {
    return this.entries.filter(
      (entry) => isTurnPost(entry) && entry.status === 409,
    );
  }
}

type ApiRead =
  | { kind: "response"; status: number; text: string; json: unknown }
  | { kind: "unreadable"; reason: string };

function describeApi(read: ApiRead): string {
  return read.kind === "response"
    ? `HTTP ${read.status} ${tail(read.text, 240)}`
    : `unreadable (${read.reason})`;
}

export class ChatReliabilitySession {
  readonly origin: string;
  readonly entryUrl: string;
  readonly traffic: TrafficRecorder;
  readonly luna: ReturnType<typeof watchChatRequests>;
  threadId: string | null = null;
  private readonly createdThreadIds = new Set<string>();
  private readonly notes: string[] = [];
  private readonly startedAt = Date.now();
  private failed = false;

  private constructor(
    readonly site: BetaSite,
    readonly testName: string,
    readonly context: BrowserContext,
    readonly page: Page,
  ) {
    this.origin = originFor(site);
    this.entryUrl = `${this.origin}${authenticatedEntryPath(site)}?agentSidebar=open`;
    this.traffic = new TrafficRecorder(this.startedAt);
    this.traffic.attach(page);
    this.luna = watchChatRequests(page);
  }

  static async create(
    browser: Browser,
    site: BetaSite,
    testName: string,
  ): Promise<ChatReliabilitySession> {
    const context = await signedInContext(browser, site);
    await context.addInitScript(installTextWatch, {
      key: WATCH_STORAGE_KEY,
      needles: [...RUN_FAILURE_TEXT],
      patterns: [...INTERNAL_LEAK_PATTERNS],
    });
    const page = await context.newPage();
    return new ChatReliabilitySession(site, testName, context, page);
  }

  note(message: string): void {
    this.notes.push(
      `+${((Date.now() - this.startedAt) / 1000).toFixed(1)}s ${message}`,
    );
  }

  annotate(type: string, description: string): void {
    test.info().annotations.push({ type, description });
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  /** Wrap a test body: on failure, append the evidence and keep the thread. */
  async run<T>(body: () => Promise<T>): Promise<T> {
    try {
      return await body();
    } catch (error) {
      this.failed = true;
      const message = error instanceof Error ? error.message : String(error);
      const diagnostics = await this.diagnostics();
      await test.info().attach("chat-reliability-diagnostics.txt", {
        body: diagnostics,
        contentType: "text/plain",
      });
      throw new Error(
        `${RELIABILITY_TAG} ${this.site.id} / ${this.testName}: ${message}\n\n${diagnostics}`,
      );
    }
  }

  async close(): Promise<void> {
    try {
      if (!this.failed) await this.deleteCreatedThreads();
    } finally {
      await this.context.close();
    }
  }

  // ---- opening and navigating ----------------------------------------

  async open(): Promise<void> {
    await this.page.goto(this.entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!(await this.composerShown(60_000))) {
      throw new Error(
        `${this.site.host} rendered no agent composer for a signed-in user at ${this.page.url()}`,
      );
    }
  }

  /** True once a composer is visible; false when none appeared in time. */
  private async composerShown(timeoutMs: number): Promise<boolean> {
    return this.page
      .locator(ANY_ROOT)
      .first()
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(
        () => true,
        () => false, // coercion-ok: the boolean is the result; callers throw with page state.
      );
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    if (await this.composerShown(30_000)) return;
    this.note("no composer after reload; reopening with agentSidebar=open");
    const url = new URL(this.page.url());
    url.searchParams.set("agentSidebar", "open");
    await this.goto(url.toString());
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    if (!(await this.composerShown(60_000))) {
      throw new Error(`no agent composer rendered at ${this.page.url()}`);
    }
  }

  /** A new empty chat: the visible "New chat" control, else a fresh entry load. */
  async startNewChat(): Promise<void> {
    const button = this.page
      .getByRole("button", { name: /^new chat$/i })
      .first();
    if (await button.isVisible()) {
      await button.click();
    } else {
      this.note("no visible New chat control; reloading the app entry instead");
      await this.goto(this.entryUrl);
    }
    if (!(await this.composerShown(30_000))) {
      throw new Error(
        `no agent composer after starting a new chat at ${this.page.url()}`,
      );
    }
  }

  threadLink(): string {
    const id = this.currentThreadId();
    if (!id)
      throw new Error(
        "no thread id is known yet, so there is nothing to reopen",
      );
    return threadDeepLink(
      this.origin,
      authenticatedEntryPath(this.site),
      id,
      this.page.url(),
    );
  }

  /**
   * The thread this test's prompt went to, remembered for cleanup: the URL, the
   * turn POST, then a stored-thread search for the nonce.
   */
  async captureThreadId(nonce: string): Promise<string | null> {
    let id =
      threadIdFromUrl(this.page.url()) ??
      threadIdFromTraffic(this.traffic.entries);
    if (!id) {
      const found = await this.apiGet(
        `${AGENT_CHAT_ROUTE}/threads?limit=5&q=${encodeURIComponent(nonce)}`,
      );
      const threads =
        found.kind === "response"
          ? (found.json as { threads?: Array<{ id?: unknown }> } | undefined)
              ?.threads
          : undefined;
      const first = threads?.[0]?.id;
      id = typeof first === "string" ? first : null;
    }
    if (id) {
      this.createdThreadIds.add(id);
      this.threadId = id;
    }
    return id;
  }

  private currentThreadId(): string | null {
    return (
      this.threadId ??
      threadIdFromUrl(this.page.url()) ??
      threadIdFromTraffic(this.traffic.entries)
    );
  }

  // ---- composer ------------------------------------------------------

  private async composer(): Promise<{
    input: Locator;
    send: Locator;
    stop: Locator;
  }> {
    const root =
      (await this.page.locator(SIDEBAR_ROOT).count()) > 0
        ? SIDEBAR_ROOT
        : ANY_ROOT;
    const slot = (name: string) =>
      this.page
        .locator(`${root} [data-agent-composer-slot="${name}"]:visible`)
        .first();
    return {
      input: slot("editor-input"),
      send: slot("send-button"),
      stop: slot("stop-button"),
    };
  }

  async readState(): Promise<StateRead> {
    return readChatState(this.page);
  }

  /**
   * What a user must never see, if it is on screen now: the failure text or
   * error card itself is the finding, so waiting out the timeout adds nothing.
   */
  private visibleFailure(state: ChatState): string | null {
    const hits = scanVisibleText(state.bodyText);
    if (hits.length > 0) {
      return `text a user must never see appeared: ${hits.map((hit) => `"${hit.label}" (${hit.excerpt})`).join("; ")}`;
    }
    if (state.errorCards.length > 0) {
      return `an error card appeared: ${JSON.stringify(state.errorCards)}`;
    }
    return null;
  }

  /**
   * Poll the page until `check` returns null. `check` describes what it sees
   * when not satisfied, so a timeout names the state the page was stuck in. A
   * visible failure ends the wait at once.
   */
  async waitUntil(
    label: string,
    check: (state: ChatState) => string | null,
    { timeoutMs, intervalMs = 250 }: { timeoutMs: number; intervalMs?: number },
  ): Promise<ChatState> {
    const deadline = Date.now() + timeoutMs;
    let observed = "no page state was read";
    do {
      const read = await this.readState();
      if (read.ok) {
        const failure = this.visibleFailure(read.state);
        if (failure) {
          throw new Error(
            `while waiting for ${label}, ${failure}. State: ${describeState(read.state)}`,
          );
        }
        const verdict = check(read.state);
        if (verdict === null) return read.state;
        observed = verdict;
      } else {
        observed = `page state unreadable (${read.reason})`;
      }
      await this.page.waitForTimeout(intervalMs);
    } while (Date.now() < deadline);
    throw new Error(
      `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}. Last observed: ${observed}`,
    );
  }

  /**
   * Type until the editor holds the text. Keys typed before the editor settles
   * are lost or wiped by a re-mount, which leaves send disabled for a prompt
   * the test believes it entered.
   */
  private async typeIntoComposer(prompt: string): Promise<void> {
    const { input } = await this.composer();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await input.click();
      await this.page.keyboard.press("ControlOrMeta+A");
      await this.page.keyboard.press("Backspace");
      await input.pressSequentially(prompt, { delay: 6 });
      const settledBy = Date.now() + 5_000;
      do {
        if (composerHoldsPrompt(await input.innerText(), prompt)) return;
        await this.page.waitForTimeout(250);
      } while (Date.now() < settledBy);
      this.note(`composer did not hold the typed text on attempt ${attempt}`);
    }
    throw new Error(
      `the composer never held the typed text after 3 attempts, so nothing could be sent (${describeState(await this.requireState())})`,
    );
  }

  private async requireState(): Promise<ChatState> {
    const read = await this.readState();
    if (!read.ok) throw new Error(`page state unreadable (${read.reason})`);
    return read.state;
  }

  /**
   * Type a prompt and send it; returns once the composer has taken it. A turn
   * POST is expected unless the message may be queued behind a running turn.
   */
  async send(
    prompt: string,
    token: string,
    { expectTurnPost = true }: { expectTurnPost?: boolean } = {},
  ): Promise<void> {
    await this.typeIntoComposer(prompt);
    const { send } = await this.composer();
    await this.waitUntil(
      `the send button to enable for the prompt containing ${token}`,
      (state) => (state.sendEnabled ? null : describeState(state)),
      { timeoutMs: 15_000 },
    );
    const turnPostsBefore = this.traffic.entries.filter(isTurnPost).length;
    await send.click();
    await this.waitUntil(
      `the composer to accept the prompt containing ${token}`,
      (state) =>
        state.composerText.trim() === ""
          ? null
          : `composer still holds ${state.composerText.length} characters; ${describeState(state)}`,
      { timeoutMs: 30_000 },
    );
    if (expectTurnPost) {
      await this.pollUntil(
        `a turn POST to ${AGENT_CHAT_ROUTE} after sending ${token}`,
        30_000,
        async () =>
          this.traffic.entries.filter(isTurnPost).length > turnPostsBefore
            ? null
            : "send was clicked and the composer cleared, but the app never POSTed a turn",
      );
    }
    this.note(`sent prompt containing ${token}`);
  }

  async stop(): Promise<void> {
    const { stop } = await this.composer();
    await stop.click({ timeout: 10_000 });
    this.note("clicked Stop");
  }

  // ---- invariants ----------------------------------------------------

  /** Whatever the user would see as finished: nothing working, nothing pending. */
  waitForIdle(label: string, timeoutMs: number): Promise<ChatState> {
    return this.waitUntil(
      label,
      (state) => (isIdle(state) ? null : describeState(state)),
      { timeoutMs },
    );
  }

  /** A person can type and the send button enables: the composer is not wedged. */
  async assertComposerUsable(): Promise<void> {
    const { input } = await this.composer();
    await this.typeIntoComposer("x");
    try {
      await this.waitUntil(
        "the send button to enable for a new message",
        (state) =>
          state.sendEnabled
            ? null
            : `typing did not enable send; ${describeState(state)}`,
        { timeoutMs: 10_000 },
      );
    } finally {
      await input.press("ControlOrMeta+A");
      await input.press("Backspace");
    }
  }

  /**
   * Nothing a user reported as "did not finish" was ever visible, no error
   * card is showing, no turn was refused with a 409, and every turn ran on luna.
   */
  async assertClean(where: string): Promise<void> {
    const watch = await readWatchHits(this.page);
    if (!watch.ok) {
      throw new Error(
        `${where}: could not read the text watch (${watch.reason})`,
      );
    }
    const read = await this.readState();
    if (!read.ok) {
      throw new Error(`${where}: could not read the page (${read.reason})`);
    }
    const hits = new Map<string, string>();
    for (const hit of watch.hits) {
      hits.set(
        hit.label,
        `${hit.excerpt} (first seen ${hit.atMs}ms after page load)`,
      );
    }
    for (const hit of scanVisibleText(read.state.bodyText)) {
      if (!hits.has(hit.label)) hits.set(hit.label, hit.excerpt);
    }
    if (hits.size > 0) {
      throw new Error(
        `${where}: text a user must never see was visible:\n${[...hits]
          .map(([label, excerpt]) => `  - "${label}": ${excerpt}`)
          .join("\n")}`,
      );
    }
    if (read.state.errorCards.length > 0) {
      throw new Error(
        `${where}: an error card is showing: ${JSON.stringify(read.state.errorCards)}`,
      );
    }
    const conflicts = this.traffic.conflicts();
    if (conflicts.length > 0) {
      throw new Error(
        `${where}: the server refused ${conflicts.length} message(s) with 409 because a run already held the thread (at ${conflicts.map((entry) => `+${(entry.atMs / 1000).toFixed(1)}s`).join(", ")})`,
      );
    }
    await this.luna.assertOnlyLuna();
  }

  // ---- server reads --------------------------------------------------

  private async api(
    method: "GET" | "DELETE",
    path: string,
    data?: unknown,
  ): Promise<ApiRead> {
    try {
      const response = await this.context.request.fetch(
        `${this.origin}${path}`,
        {
          method,
          headers: API_HEADERS,
          ...(data === undefined ? {} : { data }),
          timeout: 20_000,
        },
      );
      const text = await response.text();
      const parsed = parseJson(text);
      return {
        kind: "response",
        status: response.status(),
        text,
        json: parsed.ok ? parsed.value : undefined,
      };
    } catch (error) {
      return {
        kind: "unreadable",
        reason: (error instanceof Error ? error.message : String(error)).split(
          "\n",
        )[0],
      };
    }
  }

  apiGet(path: string): Promise<ApiRead> {
    return this.api("GET", path);
  }

  apiDelete(path: string, data?: unknown): Promise<ApiRead> {
    return this.api("DELETE", path, data);
  }

  private threadPath(id: string): string {
    return `${AGENT_CHAT_ROUTE}/threads/${encodeURIComponent(id)}`;
  }

  /** Poll a condition outside the chat DOM; `probe` returns null when it holds. */
  async pollUntil(
    label: string,
    timeoutMs: number,
    probe: () => Promise<string | null>,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let observed = "nothing read";
    do {
      const verdict = await probe();
      if (verdict === null) return;
      observed = verdict;
      await this.page.waitForTimeout(1_000);
    } while (Date.now() < deadline);
    throw new Error(
      `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${label}. Last observed: ${observed}`,
    );
  }

  /** The server agrees the run is over, so the next message cannot hit a 409. */
  async assertServerRunIdle(timeoutMs = 30_000): Promise<void> {
    const id = this.currentThreadId();
    if (!id)
      throw new Error(
        "no thread id is known, so the server run cannot be read",
      );
    await this.pollUntil(
      `the server to report no active run on thread ${id}`,
      timeoutMs,
      async () => {
        const read = await this.apiGet(
          `${AGENT_CHAT_ROUTE}/runs/active?threadId=${encodeURIComponent(id)}`,
        );
        if (read.kind !== "response" || read.status !== 200) {
          return `GET runs/active -> ${describeApi(read)}`;
        }
        const run = inspectActiveRun(read.json);
        return run.kind === "idle" ? null : `${run.kind}: ${run.detail}`;
      },
    );
  }

  /**
   * The thread the server would hand to a fresh page: stored, titled, every
   * message in a finished state, and containing the expected answers.
   */
  async assertThreadPersisted(expected: {
    minMessages: number;
    answerTokens: string[];
  }): Promise<void> {
    const id = this.currentThreadId();
    if (!id)
      throw new Error(
        "no thread id is known, so the stored thread cannot be read",
      );
    await this.pollUntil(
      `thread ${id} to be stored with finished messages`,
      30_000,
      async () => {
        const read = await this.apiGet(this.threadPath(id));
        if (read.kind !== "response" || read.status !== 200) {
          return `GET thread -> ${describeApi(read)}`;
        }
        const view = inspectPersistedThread(read.json);
        if (view.kind === "unreadable") {
          this.note(`stored thread shape not recognised: ${view.reason}`);
          return null;
        }
        const problems: string[] = [];
        if (!view.title.trim()) problems.push("title is empty");
        if (view.messages.length < expected.minMessages) {
          problems.push(
            `${view.messages.length} message(s) stored, expected at least ${expected.minMessages}`,
          );
        }
        if (view.unsettled.length > 0) {
          problems.push(
            `messages never finished: ${view.unsettled.join(", ")}`,
          );
        }
        const stored = view.messages.map((message) => message.text).join("\n");
        for (const token of expected.answerTokens) {
          if (!stored.includes(token))
            problems.push(`stored thread has no ${token}`);
        }
        return problems.length === 0
          ? null
          : `${problems.join("; ")} | ${describePersisted(view)}`;
      },
    );
  }

  /** The thread shows up in the list a history menu reads, with a title. */
  async assertThreadListed(): Promise<void> {
    const id = this.currentThreadId();
    if (!id)
      throw new Error(
        "no thread id is known, so the thread list cannot be checked",
      );
    await this.pollUntil(
      `thread ${id} to appear in the thread list with a title`,
      30_000,
      async () => {
        const read = await this.apiGet(`${AGENT_CHAT_ROUTE}/threads?limit=100`);
        if (read.kind !== "response" || read.status !== 200) {
          return `GET threads -> ${describeApi(read)}`;
        }
        const threads = (read.json as { threads?: unknown } | undefined)
          ?.threads;
        if (!Array.isArray(threads))
          return `no threads array in ${describeApi(read)}`;
        const row = threads.find(
          (thread) => (thread as { id?: unknown }).id === id,
        ) as { title?: unknown } | undefined;
        if (!row) {
          return `thread missing from the ${threads.length} listed (first ids: ${threads
            .slice(0, 5)
            .map((thread) => (thread as { id?: unknown }).id)
            .join(", ")})`;
        }
        return typeof row.title === "string" && row.title.trim()
          ? null
          : `listed with an empty title: ${JSON.stringify(row).slice(0, 240)}`;
      },
    );
  }

  /**
   * Where the app shows a history list on screen (the Chat app's rail), the
   * thread is in it under a title. Returns false when no list is visible, so
   * the stored list is the only check available for that app.
   */
  async assertHistoryRailTitled(): Promise<boolean> {
    const rows = async (): Promise<string[] | null> => {
      const list = this.page.locator(
        '[data-agent-native="chat-history-list"]:visible',
      );
      if ((await list.count()) === 0) return null;
      return list.locator(".an-chat-history-row__title").allInnerTexts();
    };
    if ((await rows()) === null) return false;
    await this.pollUntil(
      "the visible history list to show the thread under a title",
      30_000,
      async () => {
        const titles = await rows();
        return titles?.some((title) => title.trim())
          ? null
          : `history rows: ${JSON.stringify(titles)}`;
      },
    );
    return true;
  }

  private async deleteCreatedThreads(): Promise<void> {
    for (const id of this.createdThreadIds) {
      const read = await this.apiDelete(this.threadPath(id));
      if (read.kind !== "response" || read.status >= 300) {
        console.warn(
          `${RELIABILITY_TAG} could not delete thread ${id}: ${describeApi(read)}`,
        );
      }
    }
  }

  // ---- evidence ------------------------------------------------------

  async diagnostics(): Promise<string> {
    const id = this.currentThreadId();
    const sections: string[] = [
      "=== chat-reliability diagnostics ===",
      `app: ${this.origin}`,
      `thread: ${id ?? "(unknown)"}`,
      id ? `open it: ${this.safeThreadLink()}` : "",
      `page url: ${this.page.isClosed() ? "(page closed)" : this.page.url()}`,
      `elapsed: ${(this.elapsedMs() / 1000).toFixed(1)}s`,
    ].filter(Boolean);

    const read = this.page.isClosed()
      ? ({ ok: false, reason: "page closed" } as StateRead)
      : await this.readState();
    if (read.ok) {
      const state = read.state;
      sections.push(`run state: ${describeState(state)}`);
      sections.push(
        `visible alerts: ${JSON.stringify(state.alerts)}`,
        `error cards: ${JSON.stringify(state.errorCards)}`,
      );
      const transcript = state.messages.length
        ? state.messages
            .map(
              (message) =>
                `[${message.role}${message.busy ? ", streaming" : ""}] ${message.text}`,
            )
            .join("\n")
        : state.bodyText;
      sections.push(`transcript (last 600 chars):\n${tail(transcript, 600)}`);
    } else {
      sections.push(`run state: unreadable (${read.reason})`);
    }

    const watch = this.page.isClosed()
      ? ({ ok: false, reason: "page closed" } as const)
      : await readWatchHits(this.page);
    sections.push(
      watch.ok
        ? `forbidden text seen: ${watch.hits.length ? JSON.stringify(watch.hits) : "none"}`
        : `forbidden text seen: unreadable (${watch.reason})`,
    );

    sections.push(
      `agent-chat requests (${this.traffic.entries.length}):\n${summarizeTraffic(this.traffic.entries)}`,
      `luna: ${JSON.stringify(this.luna.log)}`,
    );

    if (id) {
      const thread = await this.apiGet(this.threadPath(id));
      sections.push(
        `server thread: ${
          thread.kind === "response" && thread.status === 200
            ? describePersisted(inspectPersistedThread(thread.json))
            : describeApi(thread)
        }`,
      );
      const run = await this.apiGet(
        `${AGENT_CHAT_ROUTE}/runs/active?threadId=${encodeURIComponent(id)}`,
      );
      sections.push(
        `server run: ${
          run.kind === "response" && run.status === 200
            ? inspectActiveRun(run.json).detail
            : describeApi(run)
        }`,
      );
    }
    if (this.notes.length > 0)
      sections.push(
        `notes:\n${this.notes.map((line) => `  ${line}`).join("\n")}`,
      );
    sections.push(
      this.failed
        ? "the thread was kept so it can be opened; it is not cleaned up on failure"
        : "",
    );
    return sections.filter(Boolean).join("\n");
  }

  private safeThreadLink(): string {
    try {
      return this.threadLink();
    } catch (error) {
      return `(${error instanceof Error ? error.message : String(error)})`;
    }
  }
}

/**
 * One cheap, reversible side effect the agent can perform through the app's own
 * tools, plus an independent way to read it back and to remove it.
 */
export interface MutationProbe {
  describes: string;
  prompt: string;
  answerToken: string;
  /** null when the effect exists, otherwise what the read-back showed. */
  readBack(): Promise<string | null>;
  /** null when removed, otherwise what went wrong. */
  cleanup(): Promise<string | null>;
}

export function mutationProbe(
  session: ChatReliabilitySession,
  nonce: string,
  runId: string,
): MutationProbe {
  const answerToken = `DONE-${nonce}`;
  return session.site.id === "analytics"
    ? dashboardProbe(session, nonce, runId, answerToken)
    : resourceProbe(session, nonce, answerToken);
}

function dashboardProbe(
  session: ChatReliabilitySession,
  nonce: string,
  runId: string,
  answerToken: string,
): MutationProbe {
  const id = `beta-e2e-cr-${nonce.toLowerCase()}`;
  const name = `e2e-chat-reliability ${runId} ${nonce}`;
  const read = () =>
    session.apiGet(
      `/_agent-native/actions/get-sql-dashboard?id=${encodeURIComponent(id)}`,
    );
  return {
    describes: `SQL dashboard ${id} named "${name}"`,
    prompt: `Do not ask me any questions. Call the update-dashboard action exactly once to create a SQL dashboard with dashboardId ${id}, whose config has the name ${name} and no panels at all. Then reply with exactly ${answerToken} and nothing else.`,
    answerToken,
    async readBack() {
      const result = await read();
      if (result.kind !== "response" || result.status !== 200) {
        return `get-sql-dashboard -> ${describeApi(result)}`;
      }
      const dashboard = result.json as
        | { name?: unknown; title?: unknown }
        | undefined;
      return dashboard?.name === name || dashboard?.title === name
        ? null
        : `get-sql-dashboard returned a dashboard that is not "${name}": ${tail(result.text, 240)}`;
    },
    async cleanup() {
      const first = await read();
      if (first.kind === "response" && first.status === 404) return null;
      const deleted = await session.apiDelete(
        "/_agent-native/actions/delete-sql-dashboard",
        { id },
      );
      if (deleted.kind !== "response" || deleted.status >= 300) {
        return `delete-sql-dashboard -> ${describeApi(deleted)}`;
      }
      const after = await read();
      return after.kind === "response" && after.status === 404
        ? null
        : `dashboard ${id} still readable after delete: ${describeApi(after)}`;
    },
  };
}

function resourceProbe(
  session: ChatReliabilitySession,
  nonce: string,
  answerToken: string,
): MutationProbe {
  const path = `e2e-cr-${nonce.toLowerCase()}.md`;
  const content = `chat-reliability ${nonce}`;
  type Found =
    | { kind: "present"; id: string }
    | { kind: "absent"; detail: string }
    | { kind: "unreadable"; detail: string };
  const find = async (): Promise<Found> => {
    const list = await session.apiGet(
      `/_agent-native/resources?scope=personal&includeAgentScratch=true&prefix=${encodeURIComponent(path)}`,
    );
    if (list.kind !== "response" || list.status !== 200) {
      return {
        kind: "unreadable",
        detail: `list resources -> ${describeApi(list)}`,
      };
    }
    const resources = (list.json as { resources?: unknown } | undefined)
      ?.resources;
    if (!Array.isArray(resources)) {
      return {
        kind: "unreadable",
        detail: `no resources array in ${tail(list.text, 200)}`,
      };
    }
    const found = resources.find(
      (item) => (item as { path?: unknown }).path === path,
    ) as { id?: unknown } | undefined;
    return typeof found?.id === "string"
      ? { kind: "present", id: found.id }
      : {
          kind: "absent",
          detail: `no resource at ${path} among ${resources.length} listed`,
        };
  };
  return {
    describes: `personal resource ${path}`,
    prompt: `Do not ask me any questions. Use the resources tool exactly once with action write, path ${path}, content ${content}, scope personal and visibility workspace. Then reply with exactly ${answerToken} and nothing else.`,
    answerToken,
    async readBack() {
      const found = await find();
      if (found.kind !== "present") return found.detail;
      const result = await session.apiGet(
        `/_agent-native/resources/${encodeURIComponent(found.id)}`,
      );
      if (result.kind !== "response" || result.status !== 200) {
        return `read resource -> ${describeApi(result)}`;
      }
      return result.text.includes(nonce)
        ? null
        : `resource exists but does not contain ${nonce}: ${tail(result.text, 240)}`;
    },
    async cleanup() {
      const found = await find();
      if (found.kind === "absent") return null;
      if (found.kind === "unreadable") return found.detail;
      const deleted = await session.apiDelete(
        `/_agent-native/resources/${encodeURIComponent(found.id)}`,
      );
      return deleted.kind === "response" && deleted.status < 300
        ? null
        : `delete resource -> ${describeApi(deleted)}`;
    },
  };
}

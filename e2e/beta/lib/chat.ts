import type {
  APIRequestContext,
  BrowserContext,
  Locator,
  Page,
  Request,
} from "@playwright/test";

import { renderedText } from "./app";

export const MODEL_SELECTION_STORAGE_KEY = "agent-native:chat-models:selection";

export const LUNA_OPENAI_MODEL = "gpt-5.6-luna";
export const LUNA_BUILDER_MODEL = "gpt-5-6-luna";
export const LUNA_MODEL_PATTERN = /^(?:openai\/)?gpt-5[.-]6-luna$/i;

export interface ModelSelection {
  model: string;
  engine: string;
  effort: "low" | "medium" | "high";
}

export function lunaSelection(): ModelSelection {
  const engine = process.env.BETA_E2E_ENGINE?.trim() || "ai-sdk:openai";
  const model =
    process.env.BETA_E2E_MODEL?.trim() ||
    (engine === "builder" ? LUNA_BUILDER_MODEL : LUNA_OPENAI_MODEL);
  if (!LUNA_MODEL_PATTERN.test(model)) {
    throw new Error(
      `BETA_E2E_MODEL=${model} is not a luna model. This suite is budgeted for luna; pick a gpt-5.6-luna id or change the budget deliberately.`,
    );
  }
  return { model, engine, effort: "low" };
}

export async function seedModelSelection(
  context: BrowserContext,
  selection: ModelSelection = lunaSelection(),
  namespaces: readonly string[] = [],
): Promise<void> {
  const keys = [
    MODEL_SELECTION_STORAGE_KEY,
    ...namespaces.map(
      (namespace) => `${MODEL_SELECTION_STORAGE_KEY}:${namespace}`,
    ),
  ];
  await context.addInitScript(
    ([storageKeys, value]) => {
      try {
        for (const key of storageKeys) window.localStorage.setItem(key, value);
      } catch {} // coercion-ok: a dropped seed is surfaced by assertOnlyLuna
    },
    [keys, JSON.stringify(selection)] as const,
  );
}

function isChatTurnRequest(url: string): boolean {
  if (!URL.canParse(url)) return false;
  return new URL(url).pathname
    .replace(/\/+$/, "")
    .endsWith("/_agent-native/agent-chat");
}

export interface ChatRequestLog {
  models: string[];
  engines: string[];
  modelless: number;
  count: number;
  /** One entry per turn POST, in order: what its body named at the top level. */
  requests: Array<{ model: string | null; engine: string | null }>;
  origin: string | null;
  /** Set once an engine-less turn was proven to run on the expected engine. */
  engineProof: string | null;
}

export function formatChatRequestDiagnostics(log: ChatRequestLog): string {
  return `Agent chat requests: ${JSON.stringify(log)}`;
}

export function readTurnSelection(raw: string | null): {
  model: string | null;
  engine: string | null;
} {
  if (!raw) return { model: null, engine: null };
  let body: { model?: unknown; engine?: unknown } | null;
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    // coercion-ok: a body that does not parse names no model, which assertOnlyLuna fails on.
    return { model: null, engine: null };
  }
  const named = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : null;
  return { model: named(body?.model), engine: named(body?.engine) };
}

/** What a GET said, with "could not read it" kept apart from "it said nothing". */
export type ApiProbe =
  | { kind: "response"; status: number; json: unknown }
  | { kind: "unreadable"; reason: string };

export type EngineProof =
  | { proven: true; detail: string }
  | { proven: false; reason: string };

const ENGINE_STATUS_ROUTE = "/_agent-native/agent-engine/status";
const APP_MODEL_DEFAULT_ROUTE = "/_agent-native/agent-model-defaults";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function probeBody(
  route: string,
  probe: ApiProbe,
): { body: Record<string, unknown> } | { reason: string } {
  if (probe.kind === "unreadable") {
    return { reason: `GET ${route} was unreadable (${probe.reason})` };
  }
  if (probe.status < 200 || probe.status >= 300) {
    return { reason: `GET ${route} answered HTTP ${probe.status}` };
  }
  const body = asRecord(probe.json);
  return body
    ? { body }
    : { reason: `GET ${route} did not answer with a JSON object` };
}

/**
 * Whether a turn that names no engine runs on `expectedEngine`. The server
 * picks the engine for such a turn: the app's own default for this account if
 * it has one, else the account's saved engine, else whatever credential it
 * finds. Both reads below are that resolution, so a Builder gateway or a
 * shared-credit account fails here instead of passing on the model name alone.
 */
export function judgeResolvedEngine(
  read: { status: ApiProbe; appDefault: ApiProbe },
  expectedEngine: string,
): EngineProof {
  const status = probeBody(ENGINE_STATUS_ROUTE, read.status);
  if ("reason" in status) return { proven: false, reason: status.reason };
  const { configured, engine, source } = status.body;
  if (configured !== true || typeof engine !== "string") {
    return {
      proven: false,
      reason: `GET ${ENGINE_STATUS_ROUTE} says configured=${String(configured)} engine=${String(engine)}`,
    };
  }
  if (engine !== expectedEngine) {
    return {
      proven: false,
      reason: `the account resolves to engine ${engine}, not ${expectedEngine}`,
    };
  }

  const appDefault = probeBody(APP_MODEL_DEFAULT_ROUTE, read.appDefault);
  if ("reason" in appDefault) {
    return { proven: false, reason: appDefault.reason };
  }
  const defaultEngine = appDefault.body.engine;
  if (defaultEngine !== null && typeof defaultEngine !== "string") {
    return {
      proven: false,
      reason: `GET ${APP_MODEL_DEFAULT_ROUTE} carried no engine field (got ${JSON.stringify(defaultEngine)}), so it is unknown whether the app overrides the account's engine`,
    };
  }
  if (defaultEngine !== null && defaultEngine !== expectedEngine) {
    return {
      proven: false,
      reason: `the app's default engine is ${defaultEngine}, which overrides the account's ${engine}`,
    };
  }
  return {
    proven: true,
    detail: `account engine ${engine} (source ${String(source)}), app default ${defaultEngine ?? "none"}`,
  };
}

async function readApi(
  request: APIRequestContext,
  url: string,
): Promise<ApiProbe> {
  try {
    const response = await request.get(url, {
      headers: { accept: "application/json" },
      timeout: 20_000,
    });
    const text = await response.text();
    try {
      return {
        kind: "response",
        status: response.status(),
        json: JSON.parse(text),
      };
    } catch {
      return {
        kind: "unreadable",
        reason: `HTTP ${response.status()} was not JSON: ${text.slice(0, 120)}`,
      };
    }
  } catch (error) {
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function proveResolvedEngine(
  request: APIRequestContext,
  origin: string,
  expectedEngine: string,
): Promise<EngineProof> {
  const [status, appDefault] = await Promise.all([
    readApi(request, `${origin}${ENGINE_STATUS_ROUTE}`),
    readApi(request, `${origin}${APP_MODEL_DEFAULT_ROUTE}`),
  ]);
  return judgeResolvedEngine({ status, appDefault }, expectedEngine);
}

/**
 * Everything wrong with the turns a page sent, as lines. A turn that names no
 * engine passes only with `proof`: the Chat template's composer puts the engine
 * in request `metadata`, which the server ignores, so those turns run on the
 * engine the server resolves for the account.
 */
export function spendViolations(
  log: ChatRequestLog,
  expected: Pick<ModelSelection, "engine">,
  proof: EngineProof | null,
): string[] {
  const lines: string[] = [];
  const offenders = log.models.filter(
    (model) => !LUNA_MODEL_PATTERN.test(model),
  );
  if (offenders.length > 0) {
    lines.push(`non-luna models: ${[...new Set(offenders)].join(", ")}`);
  }
  if (log.modelless > 0) {
    lines.push(
      `${log.modelless} request(s) carried no model field, so the app fell back to its own default (a message queued behind a running turn is sent this way by a host whose transport has no model of its own)`,
    );
  }
  const wrongEngine = log.engines.filter(
    (engine) => engine !== MISSING_ENGINE && engine !== expected.engine,
  );
  if (wrongEngine.length > 0) {
    lines.push(
      `routed through engine(s) ${[...new Set(wrongEngine)].join(", ")} instead of ${expected.engine}, so the turn did not provably bill the dedicated key`,
    );
  }
  const engineless = log.engines.filter(
    (engine) => engine === MISSING_ENGINE,
  ).length;
  if (engineless > 0 && !proof?.proven) {
    lines.push(
      `${engineless} request(s) named no engine, so the server chose it, and nothing proved that engine is ${expected.engine}: ${proof ? proof.reason : "no engine proof was read"}`,
    );
  }
  return lines;
}

export function watchChatRequests(page: Page): {
  log: ChatRequestLog;
  assertOnlyLuna: () => Promise<void>;
} {
  const log: ChatRequestLog = {
    models: [],
    engines: [],
    modelless: 0,
    count: 0,
    requests: [],
    origin: null,
    engineProof: null,
  };
  const expected = lunaSelection();

  page.on("request", (request: Request) => {
    if (request.method() !== "POST") return;
    if (!isChatTurnRequest(request.url())) return;
    log.count += 1;
    log.origin ??= new URL(request.url()).origin;
    const sent = readTurnSelection(request.postData());
    log.requests.push(sent);
    log.engines.push(sent.engine ?? MISSING_ENGINE);
    if (sent.model) log.models.push(sent.model);
    else log.modelless += 1;
  });

  return {
    log,
    async assertOnlyLuna() {
      if (log.count === 0) {
        throw new Error(
          "No POST to /_agent-native/agent-chat was observed, so this turn proved nothing about the agent or the model.",
        );
      }
      const engineless = log.engines.filter(
        (engine) => engine === MISSING_ENGINE,
      ).length;
      const proof =
        engineless > 0 && log.origin
          ? await proveResolvedEngine(
              page.context().request,
              log.origin,
              expected.engine,
            )
          : null;
      const problems = spendViolations(log, expected, proof);
      if (problems.length > 0) {
        throw new Error(
          [
            "Agent chat did not provably run on luna through the dedicated key.",
            `requests=${log.count} luna=${log.models.filter((m) => LUNA_MODEL_PATTERN.test(m)).length}`,
            `sent: ${log.requests.map((sent, index) => `#${index + 1} model=${sent.model ?? "(none)"} engine=${sent.engine ?? "(none)"}`).join(", ")}`,
            ...problems,
            "A seeded selection is dropped when the app's model picker does not offer it, and a turn that names no engine runs on whatever the account resolves to; either happens when the org is connected to a different engine. Check BETA_E2E_ENGINE/BETA_E2E_MODEL against what the app lists and the account's engine in Settings.",
          ].join("\n"),
        );
      }
      if (proof?.proven) {
        log.engineProof = proof.detail;
        console.log(
          `[beta-e2e] ${log.origin} sent no engine on ${engineless} turn(s); resolved engine proven ${expected.engine}: ${proof.detail}`,
        );
      }
    },
  };
}

export const MISSING_ENGINE = "(none)";

export const COMPOSER = {
  input: '[data-agent-composer-slot="editor-input"]',
  send: '[data-agent-composer-slot="send-button"]',
  stop: '[data-agent-composer-slot="stop-button"]',
  model: '[data-agent-composer-slot="model-button"]',
} as const;

/**
 * The agent chat's composer, wherever the chat is mounted. The sidebar panel, a
 * hero home, and a thread page (Dispatch `/chat/:id`, the Chat app) all render
 * AgentKit's shared composer stack, whose root carries this class, so the match
 * has to name the stack, not a layout: a `default`-variant composer outside the
 * sidebar is the chat once a thread page takes over, and every other prompt box
 * in an app (dialogs, popovers) is a different `PromptComposer` without it.
 */
export const AGENT_COMPOSER_ROOT =
  '.agentkit-composer[data-agent-composer-slot="root"]';
const visibleComposerSlot = (slot: string): string =>
  `${AGENT_COMPOSER_ROOT}:visible ${slot}:visible`;

export const VISIBLE_COMPOSER = {
  root: `${AGENT_COMPOSER_ROOT}:visible`,
  input: visibleComposerSlot(COMPOSER.input),
  send: visibleComposerSlot(COMPOSER.send),
  stop: visibleComposerSlot(COMPOSER.stop),
  model: visibleComposerSlot(COMPOSER.model),
} as const;

export async function readComposerRuntimeState(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const isVisible = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    };
    const panel = document.querySelector<HTMLElement>(
      '.agent-sidebar-panel[data-agent-sidebar-state="open"]',
    );
    const allRoots = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-agent-composer-slot="root"]',
      ),
    );
    const roots = allRoots.filter((candidate) =>
      candidate.classList.contains("agentkit-composer"),
    );
    const root = roots.find(isVisible) ?? roots[0];
    const surface = root ?? panel ?? document;
    const inputs = Array.from(
      surface.querySelectorAll<HTMLElement>(
        '[data-agent-composer-slot="editor-input"]',
      ),
    );
    const sends = Array.from(
      surface.querySelectorAll<HTMLButtonElement>(
        '[data-agent-composer-slot="send-button"]',
      ),
    );
    const input = inputs.find(isVisible) ?? inputs[0];
    const send = sends.find(isVisible) ?? sends[0];
    return {
      href: window.location.href,
      composerRootCount: roots.length,
      visibleComposerRootCount: roots.filter(isVisible).length,
      otherComposerRootCount: allRoots.length - roots.length,
      composerVariants: roots.map((candidate) =>
        candidate.getAttribute("data-agent-composer-variant"),
      ),
      inputCount: inputs.length,
      visibleInputCount: inputs.filter(isVisible).length,
      input: input
        ? {
            textContent: input.textContent,
            innerText: input.innerText,
            contentEditable: input.contentEditable,
            ariaDisabled: input.getAttribute("aria-disabled"),
            active: document.activeElement === input,
          }
        : null,
      sendCount: sends.length,
      visibleSendCount: sends.filter(isVisible).length,
      send: send
        ? {
            disabled: send.disabled,
            ariaDisabled: send.getAttribute("aria-disabled"),
          }
        : null,
      panel: panel
        ? {
            state: panel.getAttribute("data-agent-sidebar-state"),
            text: panel.innerText.slice(-500),
          }
        : null,
    };
  });
}

export const CHAT_FAILURE_PATTERNS: RegExp[] = [
  /^Error:\s/m,
  /ERROR ID:/i,
  /we ran into an issue processing your request/i,
  /provider_internal_error/i,
  /rejected the credential used for this request/i,
  /Builder rejected the connected credentials/i,
  /Missing Authentication header/i,
  /Authentication is still initializing/i,
  /rate-limiting this chat/i,
  /provider .*is overloaded/i,
  /AI is paused until an email address/i,
  /Agent panel hit a glitch/i,
  /stopped (?:without|before) sending a final message/i,
  /exhausted this turn's convergence budget/i,
  /\btimes in a row\b/i,
];

export const MISSING_FINAL_RESPONSE = '[data-testid="missing-final-response"]';

const PROMPT_PROBE_LENGTH = 40;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Whether the composer holds what was typed. The editor is a rich-text
 * surface, so it is compared on collapsed whitespace and on the prompt's
 * opening, which is enough to tell "typed" from "swallowed".
 */
export function composerHoldsPrompt(
  composerText: string,
  prompt: string,
): boolean {
  return collapseWhitespace(composerText).includes(
    collapseWhitespace(prompt).slice(0, PROMPT_PROBE_LENGTH),
  );
}

async function composerFailure(page: Page, message: string): Promise<Error> {
  return new Error(
    `${message}\nComposer runtime: ${JSON.stringify(await readComposerRuntimeState(page))}`,
  );
}

/**
 * Keys typed before the editor settles are lost or wiped by a re-mount, which
 * left the send button disabled for a prompt the spec believed it had entered.
 * Type, confirm the text is in the editor, and retype from empty if it is not.
 */
async function typePrompt(
  page: Page,
  input: Locator,
  prompt: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await input.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await input.pressSequentially(prompt, { delay: 8 });
    const settledBy = Date.now() + 5_000;
    while (Date.now() < settledBy) {
      if (composerHoldsPrompt(await input.innerText(), prompt)) return;
      await page.waitForTimeout(250);
    }
  }
  throw await composerFailure(
    page,
    "The composer never held the typed prompt after 3 attempts, so nothing could be sent.",
  );
}

async function awaitSendEnabled(page: Page, send: Locator): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await send.isEnabled()) return;
    await page.waitForTimeout(250);
  }
  throw await composerFailure(
    page,
    "The send button stayed disabled for 15s after the prompt was typed.",
  );
}

export async function sendPromptAndAwaitTurn(
  page: Page,
  prompt: string,
  { turnTimeoutMs = 180_000 }: { turnTimeoutMs?: number } = {},
): Promise<void> {
  const input = page.locator(VISIBLE_COMPOSER.input).first();
  await input.waitFor({ state: "visible", timeout: 60_000 });
  await typePrompt(page, input, prompt);

  const send = page.locator(VISIBLE_COMPOSER.send).first();
  await send.waitFor({ state: "visible", timeout: 30_000 });
  await awaitSendEnabled(page, send);

  // Armed before the click: a click that starts no turn used to read as a turn
  // that finished at once, because the stop button never appeared to wait on.
  const turnPost = page.waitForRequest(
    (request) =>
      request.method() === "POST" && isChatTurnRequest(request.url()),
    { timeout: 30_000 },
  );
  turnPost.catch(() => undefined); // coercion-ok: awaited below; this only stops an unhandled rejection if the click throws first
  try {
    await send.click();
  } catch (error) {
    throw await composerFailure(
      page,
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    await turnPost;
  } catch {
    throw await composerFailure(
      page,
      "Send was clicked but the app never POSTed a turn to /_agent-native/agent-chat within 30s.",
    );
  }

  const stop = page.locator(VISIBLE_COMPOSER.stop).first();
  // A turn the POST proves started may finish before the stop button paints,
  // so its absence here is not a failure; the hidden wait below is the gate.
  await stop
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined); // coercion-ok: see above
  await stop.waitFor({ state: "hidden", timeout: turnTimeoutMs });
}

export async function assertNoChatFailure(
  page: Page,
  where: string,
): Promise<void> {
  const text = await renderedText(page, where);
  const hits = CHAT_FAILURE_PATTERNS.filter((pattern) => pattern.test(text));
  if (hits.length === 0) return;
  const excerpt = text
    .split("\n")
    .filter((line) => hits.some((pattern) => pattern.test(line)))
    .slice(0, 6)
    .join("\n");
  throw new Error(
    `Agent chat on ${where} rendered a failure state (${hits.map(String).join(", ")}):\n${excerpt}`,
  );
}

export function countOccurrences(text: string, needle: string): number {
  if (!needle) throw new Error("countOccurrences needs a non-empty needle");
  return text.split(needle).length - 1;
}

export type ThreadReading =
  | {
      kind: "read";
      threads: Array<{ id: string; occurrences: number }>;
    }
  | { kind: "unreadable"; reason: string };

/**
 * Counts `nonce` inside each stored thread's message data, not its title or
 * preview, which echo the first message and would otherwise make a thread with
 * no assistant reply look complete.
 */
async function readThreadsContaining(
  page: Page,
  nonce: string,
): Promise<ThreadReading> {
  try {
    return await page.evaluate(async (needle): Promise<ThreadReading> => {
      const get = async (path: string) => {
        const response = await fetch(path, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(20_000),
        });
        return { status: response.status, text: await response.text() };
      };
      const list = await get(
        `/_agent-native/agent-chat/threads?limit=10&q=${encodeURIComponent(needle)}`,
      );
      if (list.status !== 200) {
        return {
          kind: "unreadable",
          reason: `thread search returned HTTP ${list.status}: ${list.text.slice(0, 160)}`,
        };
      }
      const { threads = [] } = JSON.parse(list.text) as {
        threads?: Array<{ id?: string }>;
      };
      const found: Array<{ id: string; occurrences: number }> = [];
      for (const thread of threads) {
        if (!thread.id) continue;
        const detail = await get(
          `/_agent-native/agent-chat/threads/${encodeURIComponent(thread.id)}`,
        );
        if (detail.status !== 200) {
          return {
            kind: "unreadable",
            reason: `thread ${thread.id} returned HTTP ${detail.status}: ${detail.text.slice(0, 160)}`,
          };
        }
        const { threadData } = JSON.parse(detail.text) as {
          threadData?: unknown;
        };
        const data =
          typeof threadData === "string"
            ? threadData
            : JSON.stringify(threadData ?? null);
        found.push({
          id: thread.id,
          occurrences: data.split(needle).length - 1,
        });
      }
      return { kind: "read", threads: found };
    }, nonce);
  } catch (error) {
    return {
      kind: "unreadable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The turn finished in the UI; wait until the server also holds it. Reloading
 * before that point tests a race, and a reload that then shows an empty chat
 * cannot say whether the thread was never saved or was saved and not restored.
 */
export async function awaitThreadPersisted(
  page: Page,
  nonce: string,
  { minOccurrences = 2, timeoutMs = 60_000 } = {},
): Promise<ThreadReading> {
  const deadline = Date.now() + timeoutMs;
  let last: ThreadReading = { kind: "unreadable", reason: "never read" };
  do {
    last = await readThreadsContaining(page, nonce);
    if (
      last.kind === "read" &&
      last.threads.some((thread) => thread.occurrences >= minOccurrences)
    ) {
      return last;
    }
    await page.waitForTimeout(1_500);
  } while (Date.now() < deadline);
  throw new Error(
    `The turn finished in the UI but the server never stored a thread holding ${nonce} at least ${minOccurrences} time(s), so a reload has nothing to restore. Last reading: ${JSON.stringify(last)}`,
  );
}

/** Where a chat surface stands, for the message of an assertion that failed on it. */
export async function describeChatSurface(page: Page): Promise<string> {
  try {
    const surface = await page.evaluate(() => ({
      url: window.location.href,
      bodyTail: document.body.innerText.replace(/\s+/g, " ").slice(-400),
      chatStorageKeys: Object.keys(window.localStorage).filter((key) =>
        /chat|thread|agent/i.test(key),
      ),
    }));
    return `Chat surface: ${JSON.stringify(surface)}\nComposer runtime: ${JSON.stringify(await readComposerRuntimeState(page))}`;
  } catch (error) {
    return `Chat surface unreadable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

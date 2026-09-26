import type { BrowserContext, Page, Request } from "@playwright/test";

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
}

export function formatChatRequestDiagnostics(log: ChatRequestLog): string {
  return `Agent chat requests: ${JSON.stringify(log)}`;
}

export function watchChatRequests(page: Page): {
  log: ChatRequestLog;
  assertOnlyLuna: () => void;
} {
  const log: ChatRequestLog = {
    models: [],
    engines: [],
    modelless: 0,
    count: 0,
  };
  const expected = lunaSelection();

  page.on("request", (request: Request) => {
    if (request.method() !== "POST") return;
    if (!isChatTurnRequest(request.url())) return;
    log.count += 1;
    const raw = request.postData();
    if (!raw) {
      log.modelless += 1;
      return;
    }
    try {
      const body = JSON.parse(raw) as { model?: unknown; engine?: unknown };
      log.engines.push(
        typeof body.engine === "string" && body.engine.trim()
          ? body.engine
          : MISSING_ENGINE,
      );
      if (typeof body.model === "string" && body.model.trim()) {
        log.models.push(body.model);
      } else {
        log.modelless += 1;
      }
    } catch {
      log.modelless += 1;
    }
  });

  return {
    log,
    assertOnlyLuna() {
      if (log.count === 0) {
        throw new Error(
          "No POST to /_agent-native/agent-chat was observed, so this turn proved nothing about the agent or the model.",
        );
      }
      const offenders = log.models.filter(
        (model) => !LUNA_MODEL_PATTERN.test(model),
      );
      const wrongEngine = log.engines.filter(
        (engine) => engine !== expected.engine,
      );
      if (offenders.length > 0 || log.modelless > 0 || wrongEngine.length > 0) {
        throw new Error(
          [
            "Agent chat did not run on luna, so this run billed an unbudgeted model.",
            `requests=${log.count} luna=${log.models.filter((m) => LUNA_MODEL_PATTERN.test(m)).length}`,
            offenders.length > 0
              ? `non-luna models: ${[...new Set(offenders)].join(", ")}`
              : "",
            log.modelless > 0
              ? `${log.modelless} request(s) carried no model field, so the app fell back to its own default`
              : "",
            wrongEngine.length > 0
              ? `routed through engine(s) ${[...new Set(wrongEngine)].join(", ")} instead of ${expected.engine}, so the turn did not provably bill the dedicated key`
              : "",
            "The seeded selection is dropped when the app's model picker does not offer it — usually because the org is connected to a different engine, so the requested engine's catalog is not exposed. Check BETA_E2E_ENGINE/BETA_E2E_MODEL against what the app actually lists.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    },
  };
}

const MISSING_ENGINE = "(none)";

export const COMPOSER = {
  input: '[data-agent-composer-slot="editor-input"]',
  send: '[data-agent-composer-slot="send-button"]',
  stop: '[data-agent-composer-slot="stop-button"]',
  model: '[data-agent-composer-slot="model-button"]',
} as const;

const DEFAULT_COMPOSER_ROOT =
  '[data-agent-composer-slot="root"][data-agent-composer-variant="default"]';
const HERO_COMPOSER_ROOT =
  '[data-agent-composer-slot="root"][data-agent-composer-variant="hero"]';
const VISIBLE_AGENT_COMPOSER_ROOTS = [
  `.agent-sidebar-panel[data-agent-sidebar-state="open"] ${DEFAULT_COMPOSER_ROOT}:visible`,
  `${HERO_COMPOSER_ROOT}:visible`,
];
const VISIBLE_AGENT_COMPOSER_ROOT = VISIBLE_AGENT_COMPOSER_ROOTS.join(", ");
const visibleComposerSlot = (slot: string): string =>
  VISIBLE_AGENT_COMPOSER_ROOTS.map((root) => `${root} ${slot}:visible`).join(
    ", ",
  );

export const VISIBLE_COMPOSER = {
  root: VISIBLE_AGENT_COMPOSER_ROOT,
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
    const roots = Array.from(
      (panel ?? document).querySelectorAll<HTMLElement>(
        '[data-agent-composer-slot="root"]',
      ),
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

export async function sendPromptAndAwaitTurn(
  page: Page,
  prompt: string,
  { turnTimeoutMs = 180_000 }: { turnTimeoutMs?: number } = {},
): Promise<void> {
  const input = page.locator(VISIBLE_COMPOSER.input).first();
  await input.waitFor({ state: "visible", timeout: 60_000 });
  await input.click();
  await input.pressSequentially(prompt, { delay: 8 });

  const send = page.locator(VISIBLE_COMPOSER.send).first();
  await send.waitFor({ state: "visible", timeout: 30_000 });
  try {
    await send.click();
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nComposer runtime: ${JSON.stringify(await readComposerRuntimeState(page))}`,
    );
  }

  const stop = page.locator(VISIBLE_COMPOSER.stop).first();
  await stop
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);
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

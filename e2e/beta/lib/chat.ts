import type { BrowserContext, Page, Request } from "@playwright/test";

import { renderedText } from "./app";

/**
 * Driving the agent composer, and proving which model the run actually paid for.
 *
 * Model selection is seeded into localStorage before the app boots, because the
 * in-app picker collapses to whatever engine the org has connected — on a
 * Builder-connected org there is no way to click through to a specific OpenAI
 * model. A per-request `model`/`engine` outranks every stored default, so the
 * seed decides the spend.
 *
 * A seed nobody verifies is a wish, so `watchChatRequests` reads the model back
 * off the wire. A turn that reaches the provider on some other model is a
 * failure of this suite's central cost constraint, not a detail.
 */

export const MODEL_SELECTION_STORAGE_KEY = "agent-native:chat-models:selection";

/** Luna spellings differ per engine: the OpenAI catalog is dotted, Builder's is dashed. */
export const LUNA_OPENAI_MODEL = "gpt-5.6-luna";
export const LUNA_BUILDER_MODEL = "gpt-5-6-luna";
export const LUNA_MODEL_PATTERN = /gpt-5[.-]6-luna/i;

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
  // Luna is a reasoning model whose framework default effort is "high". Left
  // alone that multiplies the token cost of every turn in this suite.
  return { model, engine, effort: "low" };
}

/** Seed the model choice before any app script runs in this context. */
export async function seedModelSelection(
  context: BrowserContext,
  selection: ModelSelection = lunaSelection(),
): Promise<void> {
  await context.addInitScript(
    ([key, value]) => {
      // A context that cannot reach localStorage cannot carry the seed. That
      // is not swallowed: the turn then posts a different model (or none), and
      // `assertOnlyLuna` fails the run naming exactly that.
      try {
        window.localStorage.setItem(key, value);
      } catch {} // coercion-ok: a dropped seed is surfaced by assertOnlyLuna
    },
    [MODEL_SELECTION_STORAGE_KEY, JSON.stringify(selection)] as const,
  );
}

/**
 * True only for the POST that starts a turn.
 *
 * The same prefix serves sub-routes the adapter also POSTs to — aborting a run
 * hits `/_agent-native/agent-chat/runs/turn/<id>/abort`, for one — and those
 * carry no model. Counting them would report a turn as billed on no model at
 * all, failing a perfectly good run. The app may be mounted under a base path,
 * so match the end of the path rather than the whole URL.
 */
function isChatTurnRequest(url: string): boolean {
  // Playwright only reports absolute request URLs, so this cannot be a
  // parse failure in disguise.
  if (!URL.canParse(url)) return false;
  return new URL(url).pathname
    .replace(/\/+$/, "")
    .endsWith("/_agent-native/agent-chat");
}

export interface ChatRequestLog {
  /** Models seen on the wire, in order. */
  models: string[];
  /** Requests whose body carried no model field at all. */
  modelless: number;
  count: number;
}

/**
 * Record the model on every agent-chat POST this page makes.
 *
 * Returns a live log plus an assertion that fails the test when anything other
 * than luna was billed — including the "no model field" case, which would
 * otherwise let a run silently fall back to the app's default.
 */
export function watchChatRequests(page: Page): {
  log: ChatRequestLog;
  assertOnlyLuna: () => void;
} {
  const log: ChatRequestLog = { models: [], modelless: 0, count: 0 };

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
      const body = JSON.parse(raw) as { model?: unknown };
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
      if (offenders.length > 0 || log.modelless > 0) {
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
            "The seeded selection is dropped when the app's model picker does not offer it — usually because the org is connected to a different engine, so the requested engine's catalog is not exposed. Check BETA_E2E_ENGINE/BETA_E2E_MODEL against what the app actually lists.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    },
  };
}

/** Composer slots, as rendered by packages/toolkit/src/composer. */
export const COMPOSER = {
  input: '[data-agent-composer-slot="editor-input"]',
  send: '[data-agent-composer-slot="send-button"]',
  stop: '[data-agent-composer-slot="stop-button"]',
  model: '[data-agent-composer-slot="model-button"]',
} as const;

/**
 * Error text the product renders when a turn fails. Every one of these is a
 * shape real users reported on beta; matching any of them fails the turn.
 */
export const CHAT_FAILURE_PATTERNS: RegExp[] = [
  // The product renders a general turn failure as a plain `Error: <message>`
  // line in the assistant bubble. Matching the family rather than listing its
  // members is what keeps this from going stale every time a new provider
  // error string is added.
  /^Error:\s/m,
  /ERROR ID:/i,
  /we ran into an issue processing your request/i,
  /provider_internal_error/i,
  /The saved provider key was rejected/i,
  /Builder rejected the connected credentials/i,
  /Missing Authentication header/i,
  /Authentication is still initializing/i,
  /rate-limiting this chat/i,
  /provider .*is overloaded/i,
  /AI is paused until an email address/i,
  // Two spellings ship for the same condition; both mean the turn produced no
  // final message.
  /stopped (?:without|before) sending a final message/i,
  /exhausted this turn's convergence budget/i,
  /\btimes in a row\b/i,
];

/**
 * The product's own marker for "this turn ended with no final message".
 *
 * Asserting on it is stronger than pattern-matching the copy, because the copy
 * has two spellings and gains more over time.
 */
export const MISSING_FINAL_RESPONSE = '[data-testid="missing-final-response"]';

/**
 * Send one prompt and wait for the turn to finish.
 *
 * "Finished" is the stop button disappearing rather than the first terminal SSE
 * frame: a turn that auto-continues emits a terminal frame per chunk while the
 * turn itself is still running, so a frame-based wait reports success early.
 */
export async function sendPromptAndAwaitTurn(
  page: Page,
  prompt: string,
  { turnTimeoutMs = 180_000 }: { turnTimeoutMs?: number } = {},
): Promise<void> {
  const input = page.locator(COMPOSER.input).first();
  await input.waitFor({ state: "visible", timeout: 60_000 });
  await input.click();
  // The composer is a ProseMirror surface; `fill()` does not produce the input
  // events it needs to enable the send button.
  await input.pressSequentially(prompt, { delay: 8 });

  const send = page.locator(COMPOSER.send).first();
  await send.waitFor({ state: "visible", timeout: 30_000 });
  await send.click();

  const stop = page.locator(COMPOSER.stop).first();
  // A turn short enough to finish before the stop button paints is still a
  // completed turn, so a missed appearance is not itself a failure.
  await stop
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => undefined);
  await stop.waitFor({ state: "hidden", timeout: turnTimeoutMs });
}

/**
 * Assert the visible transcript carries none of the product's failure shapes.
 * `where` names the app/route so a failure report does not require a rerun.
 */
export async function assertNoChatFailure(
  page: Page,
  where: string,
): Promise<void> {
  // Through renderedText: a blank transcript would satisfy every
  // "does not contain an error" check below without proving a turn happened.
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

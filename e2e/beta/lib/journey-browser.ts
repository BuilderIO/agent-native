import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { renderedText } from "./app";
import type { BetaSite } from "./fleet";
import {
  describeNavigations,
  signInNavigationReason,
  type ComposerState,
  type NavigationRecord,
} from "./journey-checks";
import { authStatePath, expectedEmail } from "./session";
import { accountMenuTrigger, readActiveOrganizationName } from "./settings";
import { BETA_E2E_TEST_TRAFFIC_HEADERS } from "./test-traffic";

/**
 * Browser-side plumbing for the `[journey]` specs: calling the app's own
 * action endpoints, watching for a sign-in surface, reading the composer.
 * The verdicts live in journey-checks.ts.
 */

export const ACTION_HEADERS = {
  ...BETA_E2E_TEST_TRAFFIC_HEADERS,
  "X-Agent-Native-Frontend": "1",
} as const;

/** `e2e-<run id>-<label>-<random>`: unique per attempt, greppable in the data. */
export function journeyToken(label: string): string {
  const run = process.env.GITHUB_RUN_ID ?? `local-${Date.now().toString(36)}`;
  return `e2e-${run}-${label}-${crypto.randomUUID().slice(0, 6)}`;
}

// ── Action endpoints ───────────────────────────────────────────────────────

export interface ActionCall {
  method: string;
  url: string;
  status: number;
  ok: boolean;
  text: string;
  /** Parsed body; only meaningful when `parsed` is true. */
  json: unknown;
  parsed: boolean;
}

export function describeCall(call: ActionCall): string {
  return `${call.method} ${call.url} -> HTTP ${call.status}: ${call.text.slice(0, 400)}`;
}

/**
 * Call an action and return what came back, whatever the status. Only a
 * transport failure throws, so the caller decides what a 4xx or 5xx means.
 */
export async function callAction(
  request: APIRequestContext,
  origin: string,
  name: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    data?: Record<string, unknown>;
    params?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<ActionCall> {
  const method = options.method ?? "GET";
  const url = `${origin}/_agent-native/actions/${name}`;
  const requestOptions = {
    headers: ACTION_HEADERS,
    timeout: options.timeoutMs ?? 60_000,
    ...(options.data ? { data: options.data } : {}),
    ...(options.params ? { params: options.params } : {}),
  };
  let response;
  try {
    response =
      method === "GET"
        ? await request.get(url, requestOptions)
        : method === "POST"
          ? await request.post(url, requestOptions)
          : await request.delete(url, requestOptions);
  } catch (error) {
    throw new Error(
      `${method} ${url} never completed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  let json: unknown;
  let parsed = true;
  try {
    json = JSON.parse(text);
  } catch {
    // coercion-ok: `parsed` records that the body was not JSON; callers read it.
    parsed = false;
  }
  return {
    method,
    url,
    status: response.status(),
    ok: response.ok(),
    text,
    json,
    parsed,
  };
}

/** The parsed JSON body of a 2xx call, or a throw naming exactly what came back. */
export function expectJsonOk<T = Record<string, unknown>>(
  call: ActionCall,
  what: string,
): T {
  if (!call.ok) {
    throw new Error(`${what} failed. ${describeCall(call)}`);
  }
  if (!call.parsed || call.json === null || typeof call.json !== "object") {
    throw new Error(
      `${what} returned HTTP ${call.status} but not a JSON object. ${describeCall(call)}`,
    );
  }
  return call.json as T;
}

/**
 * Run `body`, then `cleanup`. A cleanup failure after a passing body fails
 * the test; after a failing body it is attached as an annotation so it never
 * hides the real failure.
 */
export async function withCleanup<T>(
  body: () => Promise<T>,
  cleanup: () => Promise<string[]>,
): Promise<T> {
  let result: T;
  try {
    result = await body();
  } catch (error) {
    const failures = await cleanup();
    if (failures.length > 0) {
      test.info().annotations.push({
        type: "cleanup-failed",
        description: failures.join("; "),
      });
    }
    throw error;
  }
  const failures = await cleanup();
  if (failures.length > 0) {
    throw new Error(
      `The journey passed but could not clean up what it created: ${failures.join("; ")}`,
    );
  }
  return result;
}

// ── Pages ──────────────────────────────────────────────────────────────────

export interface ApiProbe {
  path: string;
  status: number;
  text: string;
  json: unknown;
  parsed: boolean;
}

/** GET paths from inside the page, so the request carries the page's session. */
export async function probeFromPage(
  page: Page,
  paths: readonly string[],
): Promise<ApiProbe[]> {
  const raw = await page.evaluate(async (list) => {
    const out: { path: string; status: number; text: string }[] = [];
    for (const path of list) {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: { accept: "application/json", "X-Agent-Native-Frontend": "1" },
      });
      out.push({
        path,
        status: response.status,
        text: (await response.text()).slice(0, 50_000),
      });
    }
    return out;
  }, paths);
  return raw.map((entry) => {
    let json: unknown;
    let parsed = true;
    try {
      json = JSON.parse(entry.text);
    } catch {
      // coercion-ok: `parsed` records that the body was not JSON; callers read it.
      parsed = false;
    }
    return { ...entry, json, parsed };
  });
}

export interface PageResponse {
  status: number;
  text: string;
}

/**
 * POST one file as multipart from inside the page, the way the app's own
 * upload controls do. A browser fetch carries the first-party markers
 * (`Sec-Fetch-Site`) the server's CSRF check looks for; a bare API request
 * does not, and would be refused for a reason no user ever sees.
 */
export async function uploadFromPage(
  page: Page,
  path: string,
  field: string,
  file: { name: string; type: string; bytes: Buffer },
): Promise<PageResponse> {
  return page.evaluate(
    async ([target, fieldName, name, type, base64]) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const form = new FormData();
      form.append(fieldName, new File([bytes], name, { type }));
      const response = await fetch(target, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      return {
        status: response.status,
        text: (await response.text()).slice(0, 20_000),
      };
    },
    [path, field, file.name, file.type, file.bytes.toString("base64")] as const,
  );
}

/** Send a JSON request from inside the page (same first-party reasons as above). */
export async function jsonRequestFromPage(
  page: Page,
  method: "POST" | "DELETE",
  path: string,
  body: Record<string, unknown>,
): Promise<PageResponse> {
  return page.evaluate(
    async ([verb, target, payload]) => {
      const response = await fetch(target, {
        method: verb,
        headers: { "content-type": "application/json" },
        body: payload,
        credentials: "include",
      });
      return {
        status: response.status,
        text: (await response.text()).slice(0, 20_000),
      };
    },
    [method, path, JSON.stringify(body)] as const,
  );
}

export async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    if (!document.body) throw new Error("document.body is not available");
    return document.body.innerText;
  });
}

/** 5xx responses from the app's own origin, collected as the page runs. */
export function collectServerErrors(page: Page, origin: string): string[] {
  const errors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500 && response.url().startsWith(origin)) {
      errors.push(
        `${response.request().method()} ${response.url()} -> HTTP ${response.status()}`,
      );
    }
  });
  return errors;
}

export async function readSessionEmail(
  page: Page,
): Promise<{ status: number; email: string | null; body: string }> {
  const session = await page.evaluate(async () => {
    const response = await fetch("/_agent-native/auth/session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return { status: response.status, body: await response.text() };
  });
  let email: string | null = null;
  try {
    const parsed = JSON.parse(session.body) as { email?: unknown };
    if (typeof parsed.email === "string" && parsed.email) email = parsed.email;
  } catch {
    // coercion-ok: email stays null and the caller reports the raw body.
  }
  return { status: session.status, email, body: session.body.slice(0, 200) };
}

export interface ComposerReading {
  state: ComposerState;
  detail: string;
}

/**
 * Wait for the agent composer. Returns `usable` as soon as it is enabled; a
 * composer that stays disabled, or never renders, is reported at the deadline
 * rather than on the first look, because it starts disabled while the engine
 * status loads.
 */
export async function waitForComposer(
  page: Page,
  timeoutMs: number,
): Promise<ComposerReading> {
  const deadline = Date.now() + timeoutMs;
  let last: ComposerReading | null = null;
  let lastError: unknown = null;
  for (;;) {
    try {
      const reading = await page.evaluate(() => {
        const inputs = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-agent-composer-slot="editor-input"]',
          ),
        );
        const input = inputs.find(
          (element) =>
            element.getClientRects().length > 0 &&
            window.getComputedStyle(element).visibility !== "hidden",
        );
        if (!input) return { count: inputs.length, visible: false as const };
        return {
          count: inputs.length,
          visible: true as const,
          ariaDisabled: input.getAttribute("aria-disabled"),
          contentEditable: input.contentEditable,
          label: input.getAttribute("aria-label") ?? "",
        };
      });
      lastError = null;
      if (reading.visible) {
        const disabled =
          reading.ariaDisabled === "true" ||
          reading.contentEditable === "false";
        last = {
          state: disabled ? "disabled" : "usable",
          detail: `composers=${reading.count} aria-disabled=${String(reading.ariaDisabled)} contenteditable=${reading.contentEditable} label=${JSON.stringify(reading.label.slice(0, 80))}`,
        };
        if (!disabled) return last;
      } else {
        last = {
          state: "absent",
          detail: `composers in DOM=${reading.count}, none visible`,
        };
      }
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(500);
  }
  if (!last) {
    throw new Error(
      `The page could not be read for a composer at ${page.url()}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
  return last;
}

// ── Sign-in loop detection ─────────────────────────────────────────────────

const SURFACE_KEY = "__betaE2eSignInSurface";

export interface SignInWatch {
  readonly navigations: NavigationRecord[];
  /** Name the scripted step that follows, for the navigation log. */
  step(label: string): void;
  /** Start recording this page's main-frame navigations and sign-in sightings. */
  watch(page: Page): void;
  /** Throws, with every navigation, if the sign-in surface appeared or was visited. */
  assertClean(where: string): Promise<void>;
}

/**
 * Records, across hard navigations, every URL the main frame visits and every
 * moment a visible sign-in surface (the shared auth card, the Google button,
 * the marketing home) was in the DOM. A flash that is gone by the time a
 * screenshot is taken is still in the log.
 */
export async function installSignInWatch(
  context: BrowserContext,
  allowedOrigins: readonly string[],
): Promise<SignInWatch> {
  await context.addInitScript((key: string) => {
    if (window.top !== window) return;
    const selectors = [
      "#google-btn",
      ".auth-centered",
      "[data-agent-native-marketing-home]",
    ];
    const isVisible = (element: Element): boolean =>
      element.getClientRects().length > 0 &&
      window.getComputedStyle(element).visibility !== "hidden" &&
      window.getComputedStyle(element).display !== "none";
    const seen = new Set<string>();
    const check = () => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element || !isVisible(element)) continue;
        const id = `${selector}@${window.location.pathname}`;
        if (seen.has(id)) return;
        seen.add(id);
        try {
          const prior = JSON.parse(
            window.sessionStorage.getItem(key) ?? "[]",
          ) as unknown[];
          if (prior.length < 25) {
            prior.push({
              at: new Date().toISOString(),
              url: window.location.href,
              selector,
            });
            window.sessionStorage.setItem(key, JSON.stringify(prior));
          }
        } catch {
          // coercion-ok: sessionStorage can be blocked; the navigation log still records the URL.
        }
        return;
      }
    };
    new MutationObserver(check).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
    check();
  }, SURFACE_KEY);

  const navigations: NavigationRecord[] = [];
  const pages: Page[] = [];
  let currentStep = "setup";

  const readSightings = async (page: Page): Promise<string[]> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const raw = await page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          SURFACE_KEY,
        );
        if (!raw) return [];
        const entries = JSON.parse(raw) as {
          at: string;
          url: string;
          selector: string;
        }[];
        return entries.map(
          (entry) => `${entry.at} ${entry.selector} visible on ${entry.url}`,
        );
      } catch (error) {
        lastError = error;
        await page.waitForTimeout(250);
      }
    }
    throw new Error(
      `Could not read the sign-in sightings from ${page.url()}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  };

  return {
    navigations,
    step(label) {
      currentStep = label;
    },
    watch(page) {
      pages.push(page);
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) {
          navigations.push({ step: currentStep, url: frame.url() });
        }
      });
    },
    async assertClean(where) {
      const visited = navigations.flatMap((entry) => {
        const reason = signInNavigationReason(entry.url, allowedOrigins);
        return reason ? [`[${entry.step}] ${entry.url} (${reason})`] : [];
      });
      const sightings: string[] = [];
      for (const page of pages) {
        if (!page.isClosed()) sightings.push(...(await readSightings(page)));
      }
      if (visited.length === 0 && sightings.length === 0) return;
      throw new Error(
        [
          `${where}: a signed-in e2e session was sent to, or shown, the sign-in surface. This is the "flashes to sign-in" / "signs me out" / "login loop" report.`,
          visited.length > 0
            ? `Navigations to sign-in or off the app:\n${visited.join("\n")}`
            : "",
          sightings.length > 0
            ? `Sign-in surface present in the DOM:\n${sightings.join("\n")}`
            : "",
          `All main-frame navigations (${navigations.length}):\n${describeNavigations(navigations)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  };
}

/**
 * Signed in, on an app page: no sign-in surface at any point so far, the
 * session resolves to the e2e identity, and the account menu shows it.
 */
export async function assertSignedInApp(
  page: Page,
  site: BetaSite,
  watch: SignInWatch,
  where: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<void> {
  const label = `${site.host} ${where}`;
  await renderedText(page, label, { timeoutMs });
  await watch.assertClean(label);

  const session = await readSessionEmail(page);
  const expected = expectedEmail();
  expect(
    session.email?.toLowerCase(),
    `${label}: /_agent-native/auth/session answered HTTP ${session.status} ${session.body} at ${page.url()}; expected the e2e identity ${expected}.\nNavigations so far:\n${describeNavigations(watch.navigations)}`,
  ).toBe(expected.toLowerCase());

  const organization = (await readActiveOrganizationName(page)) ?? "Personal";
  await expect(
    accountMenuTrigger(page, organization),
    `${label}: no account menu showing "${organization}" at ${page.url()}, so the page is not the signed-in app.\nNavigations so far:\n${describeNavigations(watch.navigations)}`,
  ).toBeVisible({ timeout: timeoutMs });
  await watch.assertClean(label);
}

/** The cookies a stored session for `appId` carries, for merging into another context. */
export function storedCookies(
  appId: string,
): Parameters<BrowserContext["addCookies"]>[0] {
  const file = authStatePath(appId);
  const state = JSON.parse(readFileSync(file, "utf8")) as {
    cookies?: Parameters<BrowserContext["addCookies"]>[0];
  };
  if (!Array.isArray(state.cookies) || state.cookies.length === 0) {
    throw new Error(
      `The stored session for ${appId} at ${file} carries no cookies, so a second app cannot be signed in beside the first.`,
    );
  }
  return state.cookies;
}

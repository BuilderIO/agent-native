import type { Locator, Page } from "@playwright/test";

const SIGN_IN_TEXT = /sign in|sign up|continue with google|create an account/i;
const SIGN_IN_PATH = /\/(sign-in|login)\b/;
const VECTOR_HOST_PATTERN =
  /(?:^|[^a-z0-9-])(?:[a-z0-9-]+\.)*vector\.co(?::\d+)?(?:[/'`)\s]|$)/i;

export function isKnownThirdPartyPageError(
  message: string,
  stack: string,
): boolean {
  return (
    /failed to fetch|domain not allowed/i.test(message) &&
    VECTOR_HOST_PATTERN.test(stack)
  );
}

async function readBodyText(
  page: Page,
): Promise<{ text: string } | { unreadable: string }> {
  try {
    return {
      text: await page.evaluate(() => {
        if (!document.body) throw new Error("document.body is not available");
        return document.body.innerText;
      }),
    };
  } catch (error) {
    return {
      unreadable: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function renderedText(
  page: Page,
  where: string,
  {
    minLength = 40,
    timeoutMs = 20_000,
  }: { minLength?: number; timeoutMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  let unreadable: string | undefined;
  while (Date.now() < deadline) {
    const read = await readBodyText(page);
    if ("unreadable" in read) {
      unreadable = read.unreadable;
    } else {
      unreadable = undefined;
      text = read.text;
      if (text.trim().length >= minLength) return text;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    unreadable
      ? `${where} could not be read at ${page.url()}: ${unreadable}`
      : `${where} rendered ${text.trim().length} characters of visible text at ${page.url()} — failing here rather than letting every "must not show X" assertion pass against a blank page.`,
  );
}

const DESTROYED_CONTEXT = /Execution context was destroyed/i;

/**
 * Run an in-page evaluation right after `goto(..., "domcontentloaded")`. An app
 * that redirects once its first script runs destroys the context an evaluate
 * was already sent to, and that says nothing about the app under test. Wait for
 * the document to finish loading, and when the evaluation still hits a
 * destroyed context, run it once more on the new document and report that it
 * did. A second destroyed context, and every other error, are the caller's.
 */
export async function evaluateAfterNavigation<R>(
  page: Page,
  evaluate: () => Promise<R>,
  recordRetry: (note: string) => void,
): Promise<R> {
  await page.waitForLoadState("load", { timeout: 30_000 });
  try {
    return await evaluate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!DESTROYED_CONTEXT.test(message)) throw error;
    recordRetry(
      `evaluate lost its page to a navigation and ran again at ${page.url()}: ${message.split("\n")[0]}`,
    );
    await page.waitForLoadState("load", { timeout: 30_000 });
    return await evaluate();
  }
}

export interface AuthGateOutcome {
  gated: boolean;
  url: string;
  bodyText: string;
  unreadable?: string;
}

export async function settleAuthGate(
  page: Page,
  { timeoutMs = 25_000 }: { timeoutMs?: number } = {},
): Promise<AuthGateOutcome> {
  const deadline = Date.now() + timeoutMs;
  let bodyText = "";
  let unreadable: string | undefined;

  while (Date.now() < deadline) {
    const read = await readBodyText(page);
    if ("unreadable" in read) {
      unreadable = read.unreadable;
    } else {
      unreadable = undefined;
      bodyText = read.text;
    }
    const url = page.url();
    if (
      SIGN_IN_PATH.test(new URL(url).pathname) ||
      SIGN_IN_TEXT.test(bodyText)
    ) {
      return { gated: true, url, bodyText };
    }
    if (bodyText.trim().length > 40) {
      return { gated: false, url, bodyText };
    }
    await page.waitForTimeout(500);
  }

  return {
    gated: false,
    url: page.url(),
    bodyText,
    ...(unreadable ? { unreadable } : {}),
  };
}

export const GOOGLE_BUTTON = "#google-btn";

export interface SignInAffordances {
  google: boolean;
  passwordForm: boolean;
  anySignIn: boolean;
  bodyText: string;
}

export async function readSignInAffordances(
  page: Page,
  origin: string,
): Promise<SignInAffordances> {
  await page.goto(`${origin}/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await renderedText(page, `${origin}/sign-in`);

  const google = await page.locator(GOOGLE_BUTTON).first().isVisible();
  const passwordForm = await page
    .locator('input[type="password"]')
    .first()
    .isVisible();
  const read = await readBodyText(page);
  if ("unreadable" in read) {
    throw new Error(
      `Could not read the sign-in page at ${origin}: ${read.unreadable}`,
    );
  }

  return {
    google,
    passwordForm,
    anySignIn: google || passwordForm || SIGN_IN_TEXT.test(read.text),
    bodyText: read.text,
  };
}

export function collectAppPageErrors(
  page: Page,
  appOrigin: string,
): { errors: string[]; thirdParty: string[] } {
  const errors: string[] = [];
  const thirdParty: string[] = [];

  page.on("pageerror", (error) => {
    const stack = error.stack ?? "";
    const fromKnownThirdParty = isKnownThirdPartyPageError(
      error.message,
      stack,
    );
    const fromApp =
      !fromKnownThirdParty &&
      (stack.includes(appOrigin) || !/https?:\/\//.test(stack));
    if (fromApp)
      errors.push(
        `${error.message}\n${stack.split("\n").slice(0, 3).join("\n")}`,
      );
    else thirdParty.push(error.message);
  });

  return { errors, thirdParty };
}

export async function describeFocusedElement(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return "no focused element";
      return JSON.stringify({
        tag: active.tagName,
        id: active.id || null,
        role: active.getAttribute("role"),
        ariaLabel: active.getAttribute("aria-label"),
        contentEditable: active.isContentEditable,
        className: String(active.className).slice(0, 80),
      });
    });
  } catch (error) {
    return `focused element unreadable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Press a shortcut until `target` shows, for a page whose key handler attaches
 * after the first paint: a press that lands before it is lost, so one press and
 * one long wait reports "missing" for a command that is only late. The target
 * is checked before every press because a shortcut that toggles would close the
 * menu a slow first press opened.
 */
export async function pressUntilVisible(
  page: Page,
  shortcut: string,
  target: Locator,
  { timeoutMs = 45_000, settleMs = 3_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let presses = 0;
  while (Date.now() < deadline) {
    if (await target.isVisible()) return;
    await page.keyboard.press(shortcut);
    presses += 1;
    const settledBy = Date.now() + settleMs;
    while (Date.now() < settledBy) {
      if (await target.isVisible()) return;
      await page.waitForTimeout(100);
    }
  }
  throw new Error(
    `${shortcut} was pressed ${presses} time(s) over ${Math.round(timeoutMs / 1000)}s and ${target} never became visible at ${page.url()}. Focused element: ${await describeFocusedElement(page)}`,
  );
}

export type PageVisibility = "visible" | "hidden";

interface VisibilityControlWindow {
  __betaVisibility?: { set(state: PageVisibility): void };
}

/**
 * Runs in the page before any app script. Headless Chromium keeps every page
 * in a context `visible` even after `bringToFront()` on another one, so a
 * hidden-tab precondition can never be observed there. This overrides what the
 * page reads and fires the event it listens for, which is the contract an app's
 * pause-while-hidden code depends on. Exported only so it can be unit tested.
 */
export function visibilityControlScript(): void {
  const control = window as unknown as VisibilityControlWindow;
  if (control.__betaVisibility) return;
  const nativeState = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "visibilityState",
  )?.get;
  const nativeHidden = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "hidden",
  )?.get;
  if (!nativeState || !nativeHidden) {
    throw new Error("document.visibilityState is not an accessor here");
  }
  let forced: PageVisibility | null = null;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => forced ?? nativeState.call(document),
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () =>
      forced === null ? nativeHidden.call(document) : forced === "hidden",
  });
  control.__betaVisibility = {
    set(state) {
      forced = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

export async function installVisibilityControl(page: Page): Promise<void> {
  await page.addInitScript(visibilityControlScript);
}

export async function setPageVisibility(
  page: Page,
  state: PageVisibility,
): Promise<void> {
  await page.evaluate((next) => {
    const control = (window as unknown as VisibilityControlWindow)
      .__betaVisibility;
    if (!control) {
      throw new Error(
        "installVisibilityControl() must run before this page navigates",
      );
    }
    control.set(next);
  }, state);
}

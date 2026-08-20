import type { Page } from "@playwright/test";

/**
 * Helpers for reading a beta app the way it actually renders.
 *
 * These apps are client-rendered behind a public, impersonal SSR shell: the
 * server returns the same HTML to everyone, and the decision to show the app or
 * bounce to sign-in happens after hydration. A check that reads the document at
 * `domcontentloaded` therefore sees an empty body and concludes the app served
 * a protected route to an anonymous visitor. It has to wait for the client.
 */

const SIGN_IN_TEXT = /sign in|sign up|continue with google|create an account/i;
const SIGN_IN_PATH = /\/(sign-in|login)\b/;

/**
 * Read the body text, keeping "the page rendered nothing" and "the page could
 * not be read at all" as different answers.
 *
 * A locator read rejects when the frame is mid-navigation or the context is
 * gone. Collapsing that to `""` would let a caller conclude the app rendered an
 * empty page, which is a different — and differently actionable — fact.
 */
async function readBodyText(
  page: Page,
): Promise<{ text: string } | { unreadable: string }> {
  try {
    return { text: await page.locator("body").innerText() };
  } catch (error) {
    return {
      unreadable: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read the visible text, refusing to return a blank page.
 *
 * Every "the app must NOT show X" assertion is trivially satisfied by an empty
 * string, so a page that failed to render passes all of them at once — the
 * exact failure this suite exists to catch. Reading through here turns a blank
 * page into its own explicit failure instead.
 */
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

export interface AuthGateOutcome {
  /** The app decided this visitor must sign in. */
  gated: boolean;
  url: string;
  bodyText: string;
  /** Set when the page could never be read, as distinct from rendering nothing. */
  unreadable?: string;
}

/**
 * Wait until the client has settled on either a sign-in surface or app content.
 *
 * Resolves as soon as the outcome is knowable rather than sleeping a fixed
 * amount, and reports which outcome it saw instead of asserting one.
 */
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
    // Non-trivial content with no sign-in affordance means the app rendered.
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

/**
 * What sign-in options this app actually offers a visitor right now.
 *
 * Read from the rendered page rather than assumed per app: the shared login
 * document ships markup for every provider and hides what is not configured,
 * so the HTML source says "Google" for apps that do not offer it (and matches
 * `googletagmanager.com` besides). Deriving the expectation from what renders
 * keeps the Google assertions pointed at apps that really do promise Google
 * sign-in — which is where a broken redirect_uri strands users.
 */
export async function readSignInAffordances(
  page: Page,
  origin: string,
): Promise<SignInAffordances> {
  await page.goto(`${origin}/sign-in`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(3_000);

  // `isVisible()` already answers false for an element that is absent, so
  // these are left to throw: the only rejections left are a dead page or a
  // closed context, and a Google assertion that quietly disabled itself on
  // one of those is the failure this suite exists to prevent.
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

/**
 * Uncaught errors this page's own code produced.
 *
 * Third-party marketing and analytics pixels throw on beta hosts they are not
 * registered for ("Domain not allowed" from a tracking script, for one), and
 * counting those as app failures would make this assertion permanently red for
 * a reason no app change can fix.
 */
export function collectAppPageErrors(
  page: Page,
  appOrigin: string,
): { errors: string[]; thirdParty: string[] } {
  const errors: string[] = [];
  const thirdParty: string[] = [];

  page.on("pageerror", (error) => {
    const stack = error.stack ?? "";
    const fromApp =
      stack.includes(appOrigin) ||
      // A stack with no URL at all is most likely inline app code.
      !/https?:\/\//.test(stack);
    if (fromApp)
      errors.push(
        `${error.message}\n${stack.split("\n").slice(0, 3).join("\n")}`,
      );
    else thirdParty.push(error.message);
  });

  return { errors, thirdParty };
}

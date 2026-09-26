import type { Page } from "@playwright/test";


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
      (stack.includes(appOrigin) ||
        !/https?:\/\//.test(stack));
    if (fromApp)
      errors.push(
        `${error.message}\n${stack.split("\n").slice(0, 3).join("\n")}`,
      );
    else thirdParty.push(error.message);
  });

  return { errors, thirdParty };
}

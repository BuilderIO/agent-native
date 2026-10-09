// @vitest-environment happy-dom

import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { signInJourney } from "@agent-native/core/shared/sign-in-journey";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPageProps } from "./AuthPage.js";

const ORIGIN = "https://clips.agent-native.com";

type Visit = { path: string; search?: string; referrer?: string };
type Recorded = {
  firstTouch: unknown;
  lastTouch: unknown;
  firstTouchCookie: unknown;
  lastTouchCookie: unknown;
};

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

function cookieJson(name: string): unknown {
  const part = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));
  return part
    ? JSON.parse(decodeURIComponent(part.slice(name.length + 1)))
    : null;
}

function storedJson(key: string): unknown {
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function recorded(): Recorded {
  return {
    firstTouch: storedJson("an_attribution"),
    lastTouch: storedJson("an_last_touch"),
    firstTouchCookie: cookieJson("an_ft"),
    lastTouchCookie: cookieJson("an_lt"),
  };
}

function clearBrowserState(): void {
  window.localStorage.clear();
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

function enter(url: string, referrer = ""): void {
  window.happyDOM.setURL(url);
  Object.defineProperty(document, "referrer", {
    value: referrer,
    configurable: true,
  });
}

/** Each visit is a fresh page load, so modules start over. */
async function visitSignInPage(visit: Visit): Promise<void> {
  const signInHref = signInJourney({
    at: visit.path,
    basePath: "",
    homePath: "/",
  }).signInHref!;
  const separator = signInHref.includes("?") ? "&" : "?";
  enter(
    `${ORIGIN}${signInHref}${visit.search ? separator + visit.search : ""}`,
    visit.referrer,
  );
  vi.resetModules();
  const { AuthPage } = await import("./AuthPage.js");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <AuthPage
        {...propsFromHtml(getOnboardingHtml())}
        identitySsoAuto={false}
      />,
    );
  });
  act(() => root.unmount());
  container.remove();
}

async function visitAppPage(visit: Visit): Promise<void> {
  enter(
    `${ORIGIN}${visit.path}${visit.search ? `?${visit.search}` : ""}`,
    visit.referrer,
  );
  vi.resetModules();
  const { captureAttribution } =
    await import("@agent-native/core/client/analytics");
  captureAttribution();
}

/**
 * Plays the same visits through the sign-in page and through an in-app page,
 * and returns what each stored.
 */
async function recordBoth(
  visits: Array<Visit & { at: string }>,
): Promise<{ signIn: Recorded; app: Recorded }> {
  clearBrowserState();
  for (const visit of visits) {
    vi.setSystemTime(new Date(visit.at));
    await visitSignInPage(visit);
  }
  const signIn = recorded();

  clearBrowserState();
  for (const visit of visits) {
    vi.setSystemTime(new Date(visit.at));
    await visitAppPage(visit);
  }
  return { signIn, app: recorded() };
}

describe("AuthPage attribution", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Not authenticated" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    clearBrowserState();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records the marketing site's handoff like an in-app page", async () => {
    const search = new URLSearchParams({
      utm_source: "newsletter",
      via: "site",
      site_referrer: "news.ycombinator.com",
      site_landing_path: "/templates/clips",
      last_ref: "launch-post",
      last_at: "2026-10-05T09:00:00.000Z",
    }).toString();

    const { signIn, app } = await recordBoth([
      {
        at: "2026-10-06T12:00:00.000Z",
        path: "/recordings",
        search,
        referrer: "https://agent-native.com/templates/clips",
      },
    ]);

    expect(signIn).toEqual(app);
    expect(signIn.firstTouch).toEqual({
      via: "site",
      utm_source: "newsletter",
      site_referrer: "news.ycombinator.com",
      site_landing_path: "/templates/clips",
      landing_path: "/recordings",
      landing_referrer: "agent-native.com",
      landed_at: "2026-10-06T12:00:00.000Z",
    });
    expect(signIn.lastTouch).toEqual({
      ref: "launch-post",
      landing_path: "/recordings",
      touched_at: "2026-10-05T09:00:00.000Z",
    });
  });

  it.each([
    ["gclid", "Cj0KCQ-test"],
    ["msclkid", "ms-click-test"],
  ])("keeps an ad click id (%s) like an in-app page", async (param, value) => {
    const { signIn, app } = await recordBoth([
      {
        at: "2026-10-06T12:00:00.000Z",
        path: "/",
        search: `utm_source=google&utm_medium=cpc&${param}=${value}`,
        referrer: "https://www.google.com/",
      },
    ]);

    expect(signIn).toEqual(app);
    expect(signIn.firstTouch).toMatchObject({
      [param]: value,
      landing_path: "/",
    });
    expect(signIn.lastTouch).toMatchObject({
      [param]: value,
      touched_at: "2026-10-06T12:00:00.000Z",
    });
    expect(signIn.firstTouchCookie).toMatchObject({ [param]: value });
    expect(signIn.lastTouchCookie).toMatchObject({ [param]: value });
  });

  it("lets a later tagged visit replace an untagged first visit", async () => {
    const { signIn, app } = await recordBoth([
      { at: "2026-10-01T12:00:00.000Z", path: "/" },
      {
        at: "2026-10-06T12:00:00.000Z",
        path: "/",
        search: "utm_source=bing&utm_campaign=clips-launch&msclkid=ms-1",
      },
    ]);

    expect(signIn).toEqual(app);
    expect(signIn.firstTouch).toEqual({
      utm_source: "bing",
      utm_campaign: "clips-launch",
      msclkid: "ms-1",
      landing_path: "/",
      landed_at: "2026-10-06T12:00:00.000Z",
    });
    expect(signIn.lastTouch).toEqual({
      utm_source: "bing",
      utm_campaign: "clips-launch",
      msclkid: "ms-1",
      landing_path: "/",
      touched_at: "2026-10-06T12:00:00.000Z",
    });
  });
});

// @vitest-environment happy-dom

import { CONSENT_BANNER_MESSAGES } from "@agent-native/core/localization/privacy-choice-messages";
import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { signInJourney } from "@agent-native/core/shared/sign-in-journey";
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthPageProps } from "./AuthPage.js";

const ORIGIN = "https://clips.agent-native.com";
const SIGN_IN_URL = `${ORIGIN}/login?utm_source=test&utm_medium=cpc`;
const consentStateKey = Symbol.for("agent-native.client.consent");

let root: Root | null = null;
let container: HTMLElement | null = null;
let requests: Array<{ url: string; method: string }> = [];

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  const data = match?.[1];
  if (!data) throw new Error("auth page data is missing");
  return JSON.parse(data) as AuthPageProps;
}

function cookie(name: string): string | null {
  const value = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value ? decodeURIComponent(value) : null;
}

function cookieJson(name: string): unknown {
  const value = cookie(name);
  return value === null ? null : JSON.parse(value);
}

function pinTimeZone(timeZone: string): void {
  const realOptions = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...realOptions,
    timeZone,
  });
}

type ServerRegion = "consent" | "none";

function stubServer(region: ServerRegion | Promise<ServerRegion>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET" });
      const body = url.includes("/_agent-native/auth/consent-region")
        ? { region: await region }
        : url.includes("/_agent-native/auth/attribution") ||
            url.includes("/_agent-native/auth/consent")
          ? { ok: true }
          : { error: "Not authenticated" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function sentToSignInFrom(at: string): string {
  const { signInHref } = signInJourney({ at, basePath: "", homePath: "/" });
  if (!signInHref) throw new Error(`no sign-in link for ${at}`);
  return `${ORIGIN}${signInHref}`;
}

async function renderSignInPage(
  region: ServerRegion | Promise<ServerRegion>,
  url: string,
) {
  stubServer(region);
  window.happyDOM.setURL(url);
  vi.resetModules();
  const consent = await import("@agent-native/core/client/consent");
  const { AuthPage } = await import("./AuthPage.js");
  const props = propsFromHtml(getOnboardingHtml());
  const host = document.createElement("div");
  document.body.appendChild(host);
  const created = createRoot(host);
  container = host;
  root = created;
  await act(async () => {
    created.render(<AuthPage {...props} identitySsoAuto={false} />);
  });
  return consent;
}

async function openSignInPage(region: ServerRegion, url: string = SIGN_IN_URL) {
  const consent = await renderSignInPage(region, url);
  await act(async () => {
    await consent.resolveConsentRegion();
  });
}

function banner() {
  return document.querySelector("[data-agent-native-consent-banner]");
}

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to click");
  await act(async () => {
    element.click();
  });
}

function bannerButton(name: string) {
  return [...(banner()?.querySelectorAll("button") ?? [])].find(
    (element) => element.textContent === name,
  );
}

function attributionPosts() {
  return requests.filter(
    (request) =>
      request.method === "POST" &&
      request.url.includes("/_agent-native/auth/attribution"),
  );
}

const english = CONSENT_BANNER_MESSAGES["en-US"];

describe("AuthPage cookie banner", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    requests = [];
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    Reflect.deleteProperty(globalThis, consentStateKey);
    window.localStorage.clear();
    window.sessionStorage.clear();
    for (const item of document.cookie.split(";")) {
      const name = item.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; path=/; max-age=0`;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows under the sign-in card in the consent region and stores nothing yet", async () => {
    pinTimeZone("Europe/Berlin");
    await openSignInPage("consent");

    const shown = banner();
    expect(shown).not.toBeNull();
    expect(shown?.getAttribute("aria-label")).toBe(english.label);
    expect(shown?.previousElementSibling?.classList.contains("card")).toBe(
      true,
    );
    expect(bannerButton(english.acceptAll)).toBeDefined();
    expect(bannerButton(english.rejectAll)).toBeDefined();
    expect(bannerButton(english.manage)).toBeDefined();
    expect(cookie("an_consent")).toBeNull();
    expect(cookie("an_ft")).toBeNull();
    expect(attributionPosts()).toHaveLength(0);
  });

  it("stores the visit's attribution once the visitor accepts all", async () => {
    pinTimeZone("Europe/Berlin");
    await openSignInPage("consent");

    await click(bannerButton(english.acceptAll));

    expect(cookie("an_consent")).toBe("1.p1.t1");
    expect(cookieJson("an_ft")).toMatchObject({
      utm_source: "test",
      utm_medium: "cpc",
    });
    expect(attributionPosts()).toHaveLength(1);
    expect(banner()).toBeNull();
  });

  it("stores only the choice when the visitor rejects all", async () => {
    pinTimeZone("Europe/Berlin");
    await openSignInPage("consent");

    await click(bannerButton(english.rejectAll));

    expect(cookie("an_consent")).toBe("1.p0.t0");
    expect(cookie("an_ft")).toBeNull();
    expect(window.localStorage.getItem("an_attribution")).toBeNull();
    expect(attributionPosts()).toHaveLength(0);
    expect(banner()).toBeNull();
  });

  it("saves the categories the visitor picks in Manage settings", async () => {
    pinTimeZone("Europe/Berlin");
    await openSignInPage("consent");

    await click(bannerButton(english.manage));
    await click(document.getElementById("an-consent-targeting"));
    await click(bannerButton(english.save));

    expect(cookie("an_consent")).toBe("1.p0.t1");
    expect(cookieJson("an_ft")).toMatchObject({ utm_source: "test" });
    expect(banner()).toBeNull();
  });

  it("follows the sign-in page's language", async () => {
    pinTimeZone("Europe/Berlin");
    await openSignInPage("consent");

    await click(document.getElementById("auth-locale-trigger"));
    await click(document.querySelector('[data-locale-value="de-DE"]'));

    const german = CONSENT_BANNER_MESSAGES["de-DE"];
    expect(banner()?.getAttribute("aria-label")).toBe(german.label);
    expect(bannerButton(german.acceptAll)).toBeDefined();
  });

  it("hydrates the server page without a mismatch, then shows the banner", async () => {
    pinTimeZone("Europe/Berlin");
    stubServer("consent");
    window.happyDOM.setURL(SIGN_IN_URL);
    vi.resetModules();
    const consent = await import("@agent-native/core/client/consent");
    const { AuthPage } = await import("./AuthPage.js");
    const html = getOnboardingHtml({
      renderSignInPage: (props) =>
        renderToString(createElement(AuthPage, props)),
    });
    const markup = html.match(
      /<div id="agent-native-auth-root"[^>]*>([\s\S]*?)<\/div><script type="application\/json"/,
    )?.[1];
    if (!markup) throw new Error("server markup is missing");
    expect(markup).not.toContain("data-agent-native-consent-banner");

    const host = document.createElement("div");
    host.innerHTML = markup;
    document.body.appendChild(host);
    container = host;
    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(
        host,
        <AuthPage {...propsFromHtml(html)} identitySsoAuto={false} />,
        { onRecoverableError: (error) => recoverableErrors.push(error) },
      );
    });
    await act(async () => {
      await consent.resolveConsentRegion();
    });

    expect(recoverableErrors).toEqual([]);
    expect(banner()).not.toBeNull();
  });

  it("stores the source of the page a visitor was sent to sign-in from", async () => {
    pinTimeZone("Europe/Berlin");
    await openSignInPage(
      "consent",
      sentToSignInFrom("/recordings?utm_source=test&utm_medium=cpc"),
    );

    expect(cookie("an_ft")).toBeNull();
    await click(bannerButton(english.acceptAll));

    expect(cookieJson("an_ft")).toMatchObject({
      utm_source: "test",
      utm_medium: "cpc",
      landing_path: "/recordings",
    });
  });

  it("keeps the sign-in link's own source over the page it was sent from", async () => {
    pinTimeZone("America/Los_Angeles");
    await openSignInPage(
      "none",
      `${sentToSignInFrom("/recordings?utm_source=ad&utm_campaign=spring")}&utm_source=site`,
    );

    const stored = cookieJson("an_ft");
    expect(stored).toMatchObject({ utm_source: "site" });
    expect(stored).not.toHaveProperty("utm_campaign");
  });

  it("reads the page a visitor was sent from when the sign-in link's own source is blank", async () => {
    pinTimeZone("America/Los_Angeles");
    await openSignInPage(
      "none",
      `${sentToSignInFrom("/recordings?utm_source=ad")}&utm_source=%20`,
    );

    expect(cookieJson("an_ft")).toMatchObject({
      utm_source: "ad",
      landing_path: "/recordings",
    });
  });

  it("waits for the server's region, not the time zone, before storing the page a visitor was sent from", async () => {
    pinTimeZone("America/Los_Angeles");
    let answer: (region: ServerRegion) => void = () => {};
    const region = new Promise<ServerRegion>((resolve) => {
      answer = resolve;
    });
    const consent = await renderSignInPage(
      region,
      sentToSignInFrom("/recordings?gclid=abc"),
    );

    expect(cookie("an_ft")).toBeNull();
    expect(attributionPosts()).toHaveLength(0);

    answer("consent");
    await act(async () => {
      await consent.resolveConsentRegion();
    });
    expect(cookie("an_ft")).toBeNull();
    expect(attributionPosts()).toHaveLength(0);

    await click(bannerButton(english.acceptAll));
    expect(cookieJson("an_ft")).toMatchObject({
      gclid: "abc",
      landing_path: "/recordings",
    });
    expect(attributionPosts()).toHaveLength(1);
  });

  it("keeps the site's latest visit carried in from the page a visitor was sent from", async () => {
    pinTimeZone("America/Los_Angeles");
    await openSignInPage(
      "none",
      sentToSignInFrom(
        "/recordings?utm_source=site&last_utm_source=newsletter&last_at=2026-11-01T00%3A00%3A00.000Z",
      ),
    );

    expect(cookieJson("an_ft")).toMatchObject({ utm_source: "site" });
    expect(
      JSON.parse(window.localStorage.getItem("an_last_touch") ?? "null"),
    ).toMatchObject({
      utm_source: "newsletter",
      touched_at: "2026-11-01T00:00:00.000Z",
    });
  });

  it("shows nothing outside the consent region and captures at once", async () => {
    pinTimeZone("America/Los_Angeles");
    await openSignInPage("none");

    expect(banner()).toBeNull();
    expect(cookie("an_consent")).toBeNull();
    expect(cookieJson("an_ft")).toMatchObject({
      utm_source: "test",
      utm_medium: "cpc",
    });
  });
});

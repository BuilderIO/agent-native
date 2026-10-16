// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const consentStateKey = Symbol.for("agent-native.client.consent");

let root: Root | null = null;
let container: HTMLElement | null = null;

async function renderBanner(region: "consent" | "none") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ region }))),
  );
  vi.resetModules();
  const consent = await import("@agent-native/core/client/consent");
  const { ConsentBanner } = await import("./ConsentBanner.js");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ConsentBanner />);
  });
  await act(async () => {
    await consent.resolveConsentRegion();
  });
  return consent;
}

function banner() {
  return document.querySelector("[data-agent-native-consent-banner]");
}

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (el) => el.textContent === name,
  );
  if (!match) throw new Error(`no ${name} button`);
  return match;
}

async function click(name: string) {
  await act(async () => {
    button(name).click();
  });
}

describe("ConsentBanner", () => {
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    delete (globalThis as any)[consentStateKey];
    window.sessionStorage.clear();
    for (const cookie of document.cookie.split(";")) {
      const name = cookie.split("=")[0]?.trim();
      if (name) document.cookie = `${name}=; path=/; max-age=0`;
    }
    vi.unstubAllGlobals();
  });

  it("shows nothing outside the consent region", async () => {
    await renderBanner("none");
    expect(banner()).toBeNull();
  });

  it("stores accept-all and closes", async () => {
    const consent = await renderBanner("consent");
    expect(banner()).not.toBeNull();

    await click("Accept all");

    expect(consent.getConsentChoice()).toEqual({
      performance: true,
      targeting: true,
    });
    expect(banner()).toBeNull();
  });

  it("stores reject-all and closes", async () => {
    const consent = await renderBanner("consent");

    await click("Reject all");

    expect(consent.getConsentChoice()).toEqual({
      performance: false,
      targeting: false,
    });
    expect(banner()).toBeNull();
  });

  it("saves one category from the settings", async () => {
    const consent = await renderBanner("consent");

    await click("Manage settings");
    await act(async () => {
      (
        document.getElementById("an-consent-performance") as HTMLElement
      ).click();
    });
    await click("Save choices");

    expect(consent.getConsentChoice()).toEqual({
      performance: true,
      targeting: false,
    });
  });

  it("reopens from the settings link with the stored choice", async () => {
    const consent = await renderBanner("consent");
    await click("Accept all");

    await act(async () => consent.openConsentSettings());
    await click("Manage settings");

    expect(
      document
        .getElementById("an-consent-targeting")
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });
});

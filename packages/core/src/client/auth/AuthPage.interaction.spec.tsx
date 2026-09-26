// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOnboardingHtml } from "../../server/onboarding-html.js";
import { AuthPage, type AuthPageProps } from "./AuthPage.js";

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

describe("AuthPage local development disclosure", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState({}, "", "/sign-in?c=%2Fhome");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(input).includes("/auth/local-dev")
            ? { available: true }
            : { error: "Not authenticated" },
      })),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("opens and closes the auth options without dropping focus from the localized toggle", async () => {
    await act(async () => {
      root.render(
        <AuthPage
          {...propsFromHtml(
            getOnboardingHtml({
              requestHost: "127.0.0.1",
              requestPath: "/sign-in?c=%2Fhome",
            }),
          )}
          identitySsoEnabled={false}
        />,
      );
      await Promise.resolve();
    });

    const toggle = container.querySelector<HTMLButtonElement>(
      "#local-dev-full-options",
    );
    const options =
      container.querySelector<HTMLDivElement>("#full-auth-options");
    expect(toggle).not.toBeNull();
    expect(options?.hidden).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.dataset.i18n).toBe("localDevFullOptions");
    expect(toggle?.textContent?.trim()).toBe("Show full sign in options");

    toggle?.focus();
    await act(async () => toggle?.click());

    expect(container.querySelector("#local-dev-full-options")).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(options?.hidden).toBe(false);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.dataset.i18n).toBe("localDevHideFullOptions");
    expect(toggle?.textContent?.trim()).toBe("Hide full sign in options");

    await act(async () => toggle?.click());

    expect(document.activeElement).toBe(toggle);
    expect(options?.hidden).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.dataset.i18n).toBe("localDevFullOptions");
    expect(toggle?.textContent?.trim()).toBe("Show full sign in options");
  });
});

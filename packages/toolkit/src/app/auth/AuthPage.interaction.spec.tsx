// @vitest-environment happy-dom

import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthPage, type AuthPageProps } from "./AuthPage.js";

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

describe("AuthPage interactions", () => {
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

  it("shows a loader in the disabled Google button while OAuth starts", async () => {
    const popup = {
      closed: false,
      location: { href: "" },
    } as unknown as Window;
    vi.stubGlobal(
      "open",
      vi.fn(() => popup),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("google/auth-url")) {
          return new Promise<Response>(() => {});
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            String(input).includes("/auth/local-dev")
              ? { available: true }
              : { error: "Not authenticated" },
        } as Response);
      }),
    );

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
          googleViaIdentitySso={false}
          googleAuthMode="popup"
          showGoogle
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("#local-dev-full-options")
        ?.click();
    });

    const googleButton =
      container.querySelector<HTMLButtonElement>("#google-btn");
    expect(googleButton).not.toBeNull();
    expect(googleButton?.disabled).toBe(false);

    await act(async () => googleButton?.click());

    expect(googleButton?.disabled).toBe(true);
    expect(googleButton?.getAttribute("aria-busy")).toBe("true");
    expect(googleButton?.querySelector("svg.animate-spin")).not.toBeNull();
    expect(
      googleButton?.querySelector('[data-i18n="googleButton"]'),
    ).not.toBeNull();
  });

  // Once the popup reaches Google, Cross-Origin-Opener-Policy makes the
  // opener read `popup.closed === true` while the user is still signing in.
  // That used to end the flow with "Allow popups…" and stop polling, so the
  // completed sign-in only showed up after a manual refresh.
  it("keeps finishing Google sign-in after the opener reads the popup as closed", async () => {
    vi.useFakeTimers();
    const replace = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => {});
    const popup = {
      closed: false,
      location: { href: "" },
    } as unknown as Window & { closed: boolean };
    vi.stubGlobal(
      "open",
      vi.fn(() => popup),
    );
    let exchangeReady = false;
    const reply = (body: unknown) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => body,
      } as Response);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("google/auth-url")) {
          return reply({ url: "https://accounts.google.com/o/oauth2/v2/auth" });
        }
        if (url.includes("desktop-exchange")) {
          return reply(
            exchangeReady
              ? { email: "person@example.com", token: "session-token" }
              : {},
          );
        }
        if (url.includes("/auth/local-dev")) return reply({ available: true });
        return reply({ error: "Not authenticated" });
      }),
    );

    try {
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
            googleViaIdentitySso={false}
            googleAuthMode="popup"
            showGoogle
          />,
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>("#local-dev-full-options")
          ?.click();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>("#google-btn")?.click();
        await vi.advanceTimersByTimeAsync(100);
      });

      popup.closed = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });

      expect(container.textContent).not.toContain("Allow popups");
      expect(replace).not.toHaveBeenCalled();

      exchangeReady = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(replace).toHaveBeenCalledTimes(1);
      expect(container.textContent).not.toContain("Allow popups");
    } finally {
      replace.mockRestore();
      delete window.__agentNativeNavigationStarted;
      vi.useRealTimers();
    }
  });
});

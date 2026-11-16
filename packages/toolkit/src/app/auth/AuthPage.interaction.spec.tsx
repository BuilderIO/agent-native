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
    vi.restoreAllMocks();
  });

  it.each(
    ["design", "clips", "slides"].flatMap((app) =>
      (["control", "automatic"] as const).map((variant) => ({ app, variant })),
    ),
  )(
    "shows Builder legal disclosure before $app signup only for $variant",
    async ({ app, variant }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => ({
          ok: true,
          status: 200,
          json: async () =>
            String(input).includes("builder-signup-experiment")
              ? {
                  status: "assigned",
                  id: "a".repeat(32),
                  variant,
                  policy: "builder-signup-2026-11-06",
                }
              : { available: false },
        })),
      );
      await act(async () => {
        root.render(
          <AuthPage
            {...propsFromHtml(
              getOnboardingHtml({
                requestHost: "127.0.0.1",
                requestPath: "/signup",
              }),
            )}
            trackingApp={app}
            googleOnly
            showGoogle
            signupLegalNotice={{
              termsUrl: "https://example.com/terms",
              privacyUrl: "https://example.com/privacy",
            }}
            identitySsoEnabled={false}
          />,
        );
      });
      expect(
        container.textContent?.includes(
          "You also create a Builder.io account and agree to Builder’s",
        ),
      ).toBe(variant === "automatic");
      expect(
        container.querySelector<HTMLButtonElement>("#google-btn")?.disabled,
      ).toBe(false);
      const footer = container.querySelector(".legal-note");
      if (variant === "automatic") {
        expect(footer?.textContent).not.toContain(
          "By signing up, you accept our",
        );
        expect(
          container
            .querySelector("#google-btn")
            ?.compareDocumentPosition(footer ?? container),
        ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(footer?.querySelectorAll("a").length).toBe(2);
        expect(
          container.querySelector(
            'a[href="https://www.builder.io/legal/terms"]',
          ),
        ).not.toBeNull();
        expect(
          container.querySelector(
            'a[href="https://www.builder.io/legal/privacy"]',
          ),
        ).not.toBeNull();
      } else {
        expect(footer).toBeNull();
      }
    },
  );

  it.each([200, 409])(
    "opens Google immediately and preserves the existing flow when acceptance returns %s",
    async (acceptStatus) => {
      window.history.replaceState({}, "", "/signup");
      const popup = {
        closed: false,
        location: { href: "" },
      } as unknown as Window;
      const open = vi.fn(() => popup);
      vi.stubGlobal("open", open);
      let accept: () => void = () => {
        throw new Error("Acceptance has not started");
      };
      const oauthRequests = vi.fn();
      let oauthUrl: string | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (
            url.includes("builder-signup-experiment") &&
            init?.method === "POST"
          ) {
            return new Promise<Response>((resolve) => {
              accept = () =>
                resolve(
                  new Response(JSON.stringify({ status: "accepted" }), {
                    status: acceptStatus,
                  }),
                );
            });
          }
          if (url.includes("google/auth-url")) {
            oauthUrl = url;
            oauthRequests();
            return new Promise<Response>(() => {});
          }
          return Promise.resolve(
            new Response(
              JSON.stringify(
                url.includes("builder-signup-experiment")
                  ? {
                      status: "assigned",
                      id: "a".repeat(32),
                      variant: "automatic",
                      policy: "builder-signup-2026-11-06",
                    }
                  : { available: false },
              ),
            ),
          );
        }),
      );
      await act(async () => {
        root.render(
          <AuthPage
            {...propsFromHtml(
              getOnboardingHtml({
                requestHost: "127.0.0.1",
                requestPath: "/signup",
              }),
            )}
            trackingApp="design"
            identitySsoEnabled={false}
            googleViaIdentitySso={false}
            googleAuthMode="popup"
            showGoogle
          />,
        );
      });
      const button = container.querySelector<HTMLButtonElement>("#google-btn");
      await act(async () => button?.click());
      expect(open).toHaveBeenCalledTimes(1);
      expect(button?.getAttribute("aria-busy")).toBe("true");
      expect(oauthRequests).not.toHaveBeenCalled();
      await act(async () => accept());
      expect(oauthRequests).toHaveBeenCalledTimes(1);
      expect(
        new URL(oauthUrl ?? "", "https://design.example.com").searchParams.has(
          "builder_signup_attempt",
        ),
      ).toBe(acceptStatus === 200);
    },
  );
  const jsonReply = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    } as Response);

  const renderGooglePopup = async () => {
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
  };

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

  it("uses a full-page Google redirect without a popup or desktop flow id", async () => {
    const open = vi.spyOn(window, "open");
    const replace = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => {});
    await act(async () => {
      root.render(
        <AuthPage
          {...propsFromHtml(getOnboardingHtml({ requestHost: "127.0.0.1" }))}
          identitySsoEnabled={false}
          googleViaIdentitySso={false}
          googleAuthMode="auto"
          showGoogle
        />,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("#local-dev-full-options")
        ?.click();
    });
    const button = container.querySelector<HTMLButtonElement>("#google-btn");
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(open).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledOnce();
    const target = new URL(replace.mock.calls[0]![0], window.location.origin);
    expect(target.pathname).toBe("/_agent-native/google/auth-url");
    expect(target.searchParams.get("redirect")).toBe("1");
    expect(target.searchParams.get("return")).toBeTruthy();
    expect(target.searchParams.has("flow_id")).toBe(false);
  });

  it("keeps automatic Google sign-in in a popup when embedded", async () => {
    vi.stubGlobal("top", {});
    const popup = {
      closed: false,
      location: { href: "" },
    } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);
    await act(async () => {
      root.render(
        <AuthPage
          {...propsFromHtml(getOnboardingHtml({ requestHost: "127.0.0.1" }))}
          identitySsoEnabled={false}
          googleViaIdentitySso={false}
          googleAuthMode="auto"
          showGoogle
        />,
      );
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("#local-dev-full-options")
        ?.click();
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>("#google-btn")?.click(),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0]?.[1]).toBe("_blank");
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

  it("clears Google busy with a retry notice when a closed popup has no session", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("google/auth-url")) {
          return jsonReply({
            url: "https://accounts.google.com/o/oauth2/v2/auth",
          });
        }
        if (url.includes("desktop-exchange")) return jsonReply({});
        if (url.includes("/auth/session")) {
          return jsonReply({ error: "Not authenticated" });
        }
        if (url.includes("/auth/local-dev"))
          return jsonReply({ available: true });
        return jsonReply({ error: "Not authenticated" });
      }),
    );

    try {
      await renderGooglePopup();
      popup.closed = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });

      const googleButton =
        container.querySelector<HTMLButtonElement>("#google-btn");
      expect(googleButton?.disabled).toBe(false);
      expect(googleButton?.getAttribute("aria-busy")).toBe("false");
      expect(
        container.querySelector("#google-signin .msg.error")?.textContent,
      ).toContain("Unable to sign in with Google");
      expect(replace).not.toHaveBeenCalled();
    } finally {
      replace.mockRestore();
      delete window.__agentNativeNavigationStarted;
      vi.useRealTimers();
    }
  });

  it.each([false, true])(
    "bounds Google busy independently of popup state (closed=%s)",
    async (closed) => {
      vi.useFakeTimers();
      const popup = {
        closed,
        location: { href: "" },
      } as unknown as Window & { closed: boolean };
      vi.stubGlobal(
        "open",
        vi.fn(() => popup),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("google/auth-url")) {
            return jsonReply({
              url: "https://accounts.google.com/o/oauth2/v2/auth",
            });
          }
          if (url.includes("desktop-exchange")) return jsonReply({});
          if (closed && url.includes("/auth/session")) {
            return new Promise<Response>(() => {});
          }
          if (url.includes("/auth/local-dev"))
            return jsonReply({ available: true });
          return jsonReply({ error: "Not authenticated" });
        }),
      );

      try {
        await renderGooglePopup();
        const googleButton =
          container.querySelector<HTMLButtonElement>("#google-btn");
        expect(googleButton?.disabled).toBe(true);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(popup.closed).toBe(closed);
        expect(googleButton?.disabled).toBe(false);
        expect(googleButton?.getAttribute("aria-busy")).toBe("false");
        expect(
          container.querySelector("#google-signin .msg.error")?.textContent,
        ).toContain("Unable to sign in with Google");
      } finally {
        delete window.__agentNativeNavigationStarted;
        vi.useRealTimers();
      }
    },
  );

  it("still finishes Google after the busy bound cleared the spinner", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("google/auth-url")) {
          return jsonReply({
            url: "https://accounts.google.com/o/oauth2/v2/auth",
          });
        }
        if (url.includes("desktop-exchange")) {
          return jsonReply(
            exchangeReady
              ? { email: "person@example.com", token: "session-token" }
              : {},
          );
        }
        if (url.includes("/auth/local-dev"))
          return jsonReply({ available: true });
        return jsonReply({ error: "Not authenticated" });
      }),
    );

    try {
      await renderGooglePopup();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(
        container.querySelector<HTMLButtonElement>("#google-btn")?.disabled,
      ).toBe(false);
      expect(
        container.querySelector("#google-signin .msg.error"),
      ).not.toBeNull();
      expect(replace).not.toHaveBeenCalled();

      exchangeReady = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      replace.mockRestore();
      delete window.__agentNativeNavigationStarted;
      vi.useRealTimers();
    }
  });

  it("ignores a late completion from a stale Google flow after retry", async () => {
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
    const pending: Array<(value: Response) => void> = [];
    const holdResponse = () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      });
    let flowA: string | null = null;
    let flowB: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("google/auth-url")) {
          return jsonReply({
            url: "https://accounts.google.com/o/oauth2/v2/auth",
          });
        }
        if (url.includes("desktop-exchange")) {
          const id =
            new URL(url, "http://localhost").searchParams.get("flow_id") ?? "";
          if (!flowA) flowA = id;
          if (id === flowA) return holdResponse();
          if (!flowB) flowB = id;
          if (id === flowB) return holdResponse();
          return jsonReply({});
        }
        if (url.includes("/auth/local-dev"))
          return jsonReply({ available: true });
        return jsonReply({ error: "Not authenticated" });
      }),
    );

    try {
      await renderGooglePopup();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(flowA).not.toBeNull();
      expect(pending.length).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(
        container.querySelector<HTMLButtonElement>("#google-btn")?.disabled,
      ).toBe(false);

      await act(async () => {
        container.querySelector<HTMLButtonElement>("#google-btn")?.click();
        await vi.advanceTimersByTimeAsync(100);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(flowB).not.toBeNull();
      expect(flowB).not.toBe(flowA);

      await act(async () => {
        pending[0]!({
          ok: true,
          status: 200,
          json: async () => ({
            email: "stale@example.com",
            token: "stale-token",
          }),
        } as Response);
        await vi.advanceTimersByTimeAsync(50);
      });

      expect(replace).not.toHaveBeenCalled();
      expect(
        container
          .querySelector<HTMLButtonElement>("#google-btn")
          ?.getAttribute("aria-busy"),
      ).toBe("true");

      await act(async () => {
        pending[pending.length - 1]!({
          ok: true,
          status: 200,
          json: async () => ({
            email: "live@example.com",
            token: "live-token",
          }),
        } as Response);
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      replace.mockRestore();
      delete window.__agentNativeNavigationStarted;
      vi.useRealTimers();
    }
  });

  it("stores no visitor id on the sign-in page before analytics consent", async () => {
    const originalHref = window.location.href;
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });
    window.happyDOM.setURL("https://clips.agent-native.com/signup");
    // Earlier renders in this file already settled the region.
    Reflect.deleteProperty(
      globalThis,
      Symbol.for("agent-native.client.consent"),
    );
    window.localStorage.removeItem("agent-native.anonymous_id");
    document.cookie = "an_aid=; path=/; max-age=0";
    window.sessionStorage.setItem("an_consent_region", "consent");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: Record<string, string> }
    ).__AGENT_NATIVE_CONFIG__ = {
      agentNativeAnalyticsPublicKey: "anpk_test",
      agentNativeAnalyticsEndpoint: "https://analytics.agent-native.com/track",
    };

    try {
      await act(async () => {
        root.render(
          <AuthPage
            {...propsFromHtml(
              getOnboardingHtml({
                requestHost: "clips.agent-native.com",
                requestPath: "/signup",
              }),
            )}
            initialView="signup"
          />,
        );
        await Promise.resolve();
      });

      const email = container.querySelector<HTMLInputElement>("#s-email");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(email, "person@example.com");
        email!.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(sendBeacon).toHaveBeenCalled();
      for (const [, body] of sendBeacon.mock.calls as unknown as [
        string,
        string,
      ][]) {
        const sent = JSON.parse(body);
        expect(sent.anonymousId).toBeUndefined();
        expect(sent.properties.analytics_consent).toBe("withheld");
      }
      expect(window.localStorage.getItem("agent-native.anonymous_id")).toBe(
        null,
      );
      expect(document.cookie).not.toMatch(/an_aid=[^;]/);
    } finally {
      delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
        .__AGENT_NATIVE_CONFIG__;
      window.sessionStorage.removeItem("an_consent_region");
      Reflect.deleteProperty(
        globalThis,
        Symbol.for("agent-native.client.consent"),
      );
      Reflect.deleteProperty(navigator, "sendBeacon");
      window.happyDOM.setURL(originalHref);
    }
  });

  it("sends a beta app's sign-up events to beta Analytics", async () => {
    const originalHref = window.location.href;
    const sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      value: sendBeacon,
      configurable: true,
    });
    window.happyDOM.setURL("https://beta.clips.agent-native.com/signup");
    window.localStorage.setItem("agent-native.anonymous_id", "anon_1");
    (
      window as Window & { __AGENT_NATIVE_CONFIG__?: Record<string, string> }
    ).__AGENT_NATIVE_CONFIG__ = {
      agentNativeAnalyticsPublicKey: "anpk_test",
      agentNativeAnalyticsEndpoint: "https://analytics.agent-native.com/track",
    };

    try {
      await act(async () => {
        root.render(
          <AuthPage
            {...propsFromHtml(
              getOnboardingHtml({
                requestHost: "beta.clips.agent-native.com",
                requestPath: "/signup",
              }),
            )}
            initialView="signup"
          />,
        );
        await Promise.resolve();
      });

      const email = container.querySelector<HTMLInputElement>("#s-email");
      expect(email).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(email, "person@example.com");
        email!.dispatchEvent(new Event("input", { bubbles: true }));
      });

      expect(sendBeacon).toHaveBeenCalled();
      const sessionId = window.localStorage.getItem("agent-native.session_id");
      expect(sessionId).toBeTruthy();
      for (const [url, body] of sendBeacon.mock.calls as unknown as [
        string,
        string,
      ][]) {
        expect(url).toBe("https://beta.analytics.agent-native.com/track");
        expect(JSON.parse(body).sessionId).toBe(sessionId);
      }
      expect(document.cookie).toContain(
        `an_sid=${encodeURIComponent(sessionId!)}`,
      );
    } finally {
      delete (window as Window & { __AGENT_NATIVE_CONFIG__?: unknown })
        .__AGENT_NATIVE_CONFIG__;
      window.localStorage.removeItem("agent-native.anonymous_id");
      Reflect.deleteProperty(navigator, "sendBeacon");
      window.happyDOM.setURL(originalHref);
    }
  });
});

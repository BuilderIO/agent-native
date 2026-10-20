// @vitest-environment happy-dom

import { getOnboardingHtml } from "@agent-native/core/server/onboarding-html";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthPage, type AuthPageProps } from "./AuthPage.js";

const { navigateForSession } = vi.hoisted(() => ({
  navigateForSession: vi.fn(),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  navigateForSession,
}));
vi.mock("../shared/WaveBackground.js", () => ({ WaveBackground: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("AuthPage existing-session recovery", () => {
  it.each(["verification_link_invalid", "INVALID_TOKEN", null])(
    "keeps verification feedback visible for error %s",
    async (error) => {
      window.history.replaceState(
        null,
        "",
        `/sign-in?c=JTJGcGxhbnM${error ? `&error=${error}` : ""}`,
      );
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ email: "person@example.com" }), {
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const html = getOnboardingHtml({ requestPath: window.location.href });
      const match = html.match(
        /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
      );
      if (!match) throw new Error("Auth page data is missing");
      await act(async () => {
        render(<AuthPage {...(JSON.parse(match[1]!) as AuthPageProps)} />);
      });

      if (error) {
        await screen.findByText(
          "This verification link is invalid or expired. Request a new one.",
        );
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(navigateForSession).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(navigateForSession).toHaveBeenCalledWith(
            "/plans",
            "signed_in_app",
          ),
        );
      }
    },
  );
});

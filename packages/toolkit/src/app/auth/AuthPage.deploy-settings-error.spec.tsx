// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOnboardingHtml } from "../../../../core/src/server/onboarding-html.js";
import { DEPLOY_SETTINGS_REQUIRED_CODE } from "../../../../core/src/shared/runtime-config.js";
import { AuthPage, type AuthPageProps } from "./AuthPage.js";

function propsFromHtml(html: string): AuthPageProps {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("auth page data is missing");
  return JSON.parse(match[1]!) as AuthPageProps;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// The server serves a setup page instead of sign-in while a required setting
// is missing, so the sign-in page itself only has to explain a refusal that a
// copy cached before the setting went missing can still reach.
describe("AuthPage deploy settings refusal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("explains a sign-up refused for a missing deploy setting", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/_agent-native/auth/session"))
        return jsonResponse(200, { error: "Not authenticated" });
      if (url.endsWith("/_agent-native/auth/register"))
        return jsonResponse(503, {
          error: "This deployment is missing required settings.",
          code: DEPLOY_SETTINGS_REQUIRED_CODE,
        });
      return jsonResponse(404, { error: "Not found" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        <AuthPage
          {...propsFromHtml(getOnboardingHtml())}
          identitySsoAuto={false}
        />,
      );
    });

    await act(() => {
      for (const [id, value] of [
        ["s-email", "new@example.com"],
        ["s-pass", "password123"],
        ["s-pass2", "password123"],
      ]) {
        const input = container.querySelector(`#${id}`) as HTMLInputElement;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await act(async () => {
      container
        .querySelector("#signup-form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    await vi.waitFor(() =>
      expect(container.textContent).toContain(
        "Accounts are unavailable until this deployment is set up.",
      ),
    );
    expect(container.textContent).not.toContain(
      "We couldn't create your account",
    );
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/_agent-native/ping"),
      ),
    ).toBe(false);
  });
});

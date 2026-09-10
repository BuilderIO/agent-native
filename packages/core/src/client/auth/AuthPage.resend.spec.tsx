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

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installAuthFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/_agent-native/auth/session"))
      return jsonResponse(200, { error: "Not authenticated" });
    if (url.endsWith("/_agent-native/auth/register"))
      return jsonResponse(200, {});
    if (url.endsWith("/_agent-native/auth/login"))
      return jsonResponse(403, { error: "Email not verified" });
    if (url.endsWith("/_agent-native/auth/ba/send-verification-email"))
      return jsonResponse(200, {});
    return jsonResponse(404, { error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function enterVerification(
  container: HTMLElement,
  email: string,
): Promise<void> {
  await act(() => {
    for (const [id, value] of [
      ["s-email", email],
      ["s-pass", "password123"],
      ["s-pass2", "password123"],
    ]) {
      const input = container.querySelector(`#${id}`) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await act(async () => {
    container
      .querySelector("#signup-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() =>
    expect(container.querySelector("#verify-email")?.textContent).toBe(email),
  );
}

describe("AuthPage verification resend cooldown", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    window.sessionStorage.clear();
    installAuthFetchMock();
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

  it("clears the cooldown when starting a different signup", async () => {
    act(() =>
      root.render(
        <AuthPage
          {...propsFromHtml(getOnboardingHtml())}
          identitySsoAuto={false}
        />,
      ),
    );
    await enterVerification(container, "a@example.com");

    const resend = () =>
      container.querySelector("#resend-verification") as HTMLButtonElement;
    await act(async () => {
      resend().click();
    });
    expect(resend().disabled).toBe(true);

    await act(async () => {
      (container.querySelector("#back-to-signup") as HTMLButtonElement).click();
    });
    await enterVerification(container, "b@example.com");

    expect(resend().disabled).toBe(false);
  });

  it("refreshes an expired cooldown when the tab becomes visible", async () => {
    act(() =>
      root.render(
        <AuthPage
          {...propsFromHtml(getOnboardingHtml())}
          identitySsoAuto={false}
        />,
      ),
    );
    await enterVerification(container, "person@example.com");

    const resend = () =>
      container.querySelector("#resend-verification") as HTMLButtonElement;
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    await act(async () => {
      resend().click();
    });
    expect(resend().disabled).toBe(true);

    nowSpy.mockReturnValue(now + 60_001);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(resend().disabled).toBe(false);
  });
});

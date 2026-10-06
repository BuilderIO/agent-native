// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    ({
      "plansPage.loadError.signInWithEmail": "Sign in with email",
      "plansPage.loadError.email": "Email",
      "plansPage.loadError.password": "Password",
      "plansPage.loadError.createAccount": "Create account",
      "plansPage.loadError.signIn": "Sign in",
      "plansPage.loadError.haveAccount": "I have an account",
      "plansPage.loadError.verifyEmail":
        "Check email and open the verification link",
      "plansPage.loadError.resendVerification": "Resend verification email",
      "plansPage.loadError.resendingVerification":
        "Sending verification email…",
      "plansPage.loadError.verificationEmailResent": "Verification email sent.",
      "plansPage.loadError.verificationEmailFailed":
        "Could not resend the verification email. Try again.",
    })[key] ?? key,
}));

import {
  decodeContinuation,
  SIGN_IN_ENTRY_PATH,
} from "@agent-native/core/shared/sign-in-journey";

import {
  buildPlanEmailVerificationCallbackURL,
  PlanLoadError,
} from "./PlansPage";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.history.replaceState({}, "", "/plans/plan-42?tab=comments#thread-9");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

function render(ui: React.ReactElement) {
  act(() => root.render(ui));
}

function buttonWithText(text: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitInlineSignup(loginError: string, loginStatus = 401) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ message: loginError }), {
        status: loginStatus,
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const planError = Object.assign(new Error("No access"), { status: 403 });
  render(
    <PlanLoadError
      error={planError}
      onRetry={() => {}}
      onSignIn={() => {}}
      onGoogleSignIn={() => {}}
      onRequestAccess={() => {}}
    />,
  );

  act(() => buttonWithText("Sign in with email")?.click());
  act(() => buttonWithText("Create account")?.click());

  const email = container.querySelector<HTMLInputElement>("#plan-access-email");
  const password = container.querySelector<HTMLInputElement>(
    "#plan-access-password",
  );
  const form = container.querySelector("form");
  expect(email, container.innerHTML).not.toBeNull();
  expect(password).not.toBeNull();
  expect(form).not.toBeNull();
  setInputValue(email!, "person@cbre.com");
  setInputValue(password!, "correct-horse-battery-staple");

  await act(async () => {
    form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return { fetchMock, form: form! };
}

describe("Plan inline email signup verification", () => {
  it("routes the verification callback through shared sign-in back to the current plan", () => {
    const callback = new URL(
      buildPlanEmailVerificationCallbackURL(window.location),
      window.location.origin,
    );

    expect(callback.pathname).toBe(SIGN_IN_ENTRY_PATH);
    expect(decodeContinuation(callback.searchParams.get("c"))).toBe(
      "/plans/plan-42?tab=comments#thread-9",
    );
  });

  it("shows a sign-in next step for Core's unverified-email login error", async () => {
    const { fetchMock, form } = await submitInlineSignup(
      "Your email isn't verified yet. Check your inbox for a verification link.",
      403,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const registrationRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const registrationBody = JSON.parse(registrationRequest.body as string) as {
      callbackURL: string;
    };
    const callback = new URL(
      registrationBody.callbackURL,
      window.location.origin,
    );
    expect(callback.pathname).toBe(SIGN_IN_ENTRY_PATH);
    expect(decodeContinuation(callback.searchParams.get("c"))).toBe(
      "/plans/plan-42?tab=comments#thread-9",
    );
    expect(form.textContent).toContain(
      "Check email and open the verification link",
    );
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.textContent,
    ).toContain("Sign in");
  });

  it("resends to the same Plan callback, reports failures, and allows retry", async () => {
    const { fetchMock, form } = await submitInlineSignup(
      "Your email isn't verified yet. Check your inbox for a verification link.",
      403,
    );
    const registrationRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const registrationBody = JSON.parse(registrationRequest.body as string) as {
      callbackURL: string;
    };
    const expectedRequest = expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        email: "person@cbre.com",
        callbackURL: registrationBody.callbackURL,
      }),
    });
    const resendButton = () =>
      [...form.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Resend verification email"),
      );

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Email unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await act(async () => {
      resendButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/_agent-native/auth/ba/send-verification-email",
      expectedRequest,
    );
    expect(form.textContent).toContain(
      "Could not resend the verification email. Try again.",
    );

    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => {
      resendButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/_agent-native/auth/ba/send-verification-email",
      expectedRequest,
    );
    expect(form.textContent).toContain(
      "Could not resend the verification email. Try again.",
    );

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await act(async () => {
      resendButton()?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/_agent-native/auth/ba/send-verification-email",
      expectedRequest,
    );
    expect(form.textContent).toContain("Verification email sent.");
  });

  it("keeps a non-verification login failure visible after signup", async () => {
    const { form } = await submitInlineSignup("Credentials unavailable");

    expect(form.textContent).toContain("Credentials unavailable");
    expect(form.textContent).not.toContain(
      "Check email and open the verification link",
    );
    expect(
      form.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.textContent,
    ).toContain("Create account");
  });
});

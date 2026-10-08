// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/labs", () => ({
  CLIPS_MEETINGS: "clips-meetings",
  CLIPS_WISPRFLOW: "clips-wisprflow",
  isLabEnabled: () => false,
}));

import { SignInForm } from "../app";

describe("SignInForm two-step verification", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("keeps an invalid code editable and completes sign-in after a valid retry", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let verificationAttempts = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.endsWith("/_agent-native/auth/local-dev")) {
          return new Response('{"available":false}', { status: 200 });
        }
        if (url.endsWith("/_agent-native/auth/login")) {
          return new Response('{"twoFactorRedirect":true}', { status: 200 });
        }
        if (url.endsWith("/_agent-native/auth/two-factor/verify")) {
          verificationAttempts += 1;
          const body = JSON.parse(String(init?.body)) as { code: string };
          expect(body.code).toBe(
            verificationAttempts === 1 ? "000000" : "123456",
          );
          return verificationAttempts === 1
            ? new Response('{"error":"Invalid TOTP code"}', { status: 400 })
            : new Response('{"ok":true,"token":"desktop-token"}', {
                status: 200,
              });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    const onSignedIn = vi.fn();

    await act(async () => {
      root.render(
        <SignInForm
          serverUrl="https://clips.example"
          onSignedIn={onSignedIn}
          onUseBrowser={vi.fn()}
          onMagicLink={vi.fn()}
          magicLinkSentEmail={null}
          onMagicLinkBack={vi.fn()}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const setInput = (input: HTMLInputElement, value: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const submit = async () => {
      await act(async () => {
        host
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };
    const clickButton = (label: string) =>
      act(() => {
        const button = Array.from(host.querySelectorAll("button")).find(
          (candidate) => candidate.textContent?.trim() === label,
        );
        expect(button).toBeDefined();
        button!.click();
      });

    clickButton("Use a password instead");
    setInput(host.querySelector('input[type="email"]')!, "user@example.com");
    setInput(host.querySelector('input[type="password"]')!, "secret-password");
    await submit();

    expect(host.textContent).toContain("Two-step verification");
    expect(
      host.querySelector('input[autocomplete="one-time-code"]'),
    ).not.toBeNull();

    setInput(
      host.querySelector('input[autocomplete="one-time-code"]')!,
      "000000",
    );
    await submit();

    const codeInput = host.querySelector<HTMLInputElement>(
      'input[autocomplete="one-time-code"]',
    );
    expect(host.textContent).toContain("Two-step verification");
    expect(codeInput?.value).toBe("000000");
    expect(onSignedIn).not.toHaveBeenCalled();

    setInput(codeInput!, "123456");
    await submit();

    expect(verificationAttempts).toBe(2);
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(
      host.querySelector('input[autocomplete="one-time-code"]'),
    ).toBeNull();
  });
});

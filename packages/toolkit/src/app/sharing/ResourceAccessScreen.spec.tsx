// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import {
  ResourceAccessScreen,
  type ResourceAccessScreenProps,
} from "./ResourceAccessScreen.js";

const signInHref = vi.hoisted(() => vi.fn(() => "/_agent-native/sign-in"));

vi.mock("@agent-native/core/client/sign-in-return", () => ({
  buildSignInReturnHref: signInHref,
}));

const catalog = createToolkitI18nCatalog({ messages: {} });

describe("ResourceAccessScreen", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(props: ResourceAccessScreenProps, locale = "en-US") {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={catalog}
          initialLocale={locale}
          initialPreference={locale}
          persistPreference={false}
        >
          <ResourceAccessScreen {...props} />
        </AgentNativeI18nProvider>,
      );
    });
  }

  function buttons() {
    return [...container.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
  }

  it("says the viewer has no access, names their account, and focuses the heading", () => {
    const onSwitchAccount = vi.fn();
    render({
      state: "denied",
      signedInEmail: "outsider@example.test",
      actions: <a href="/home">Go to my pages</a>,
      onSwitchAccount,
    });

    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe("You don't have access");
    expect(document.activeElement).toBe(heading);
    expect(
      container.querySelector("section")?.getAttribute("aria-labelledby"),
    ).toBe(heading?.id);
    expect(container.textContent).toContain(
      "You're signed in as outsider@example.test",
    );
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(container.querySelector("main")).toBeNull();

    const switchAccount = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Switch account",
    );
    act(() => switchAccount?.click());
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);
  });

  it("puts the app's actions before Switch account", () => {
    render({
      state: "denied",
      actions: <button type="button">Go to my pages</button>,
      onSwitchAccount: () => {},
    });

    expect(buttons()).toEqual(["Go to my pages", "Switch account"]);
  });

  it("uses the app's heading and description when given", () => {
    render({
      state: "missing",
      title: "This page doesn't exist",
      description: "Custom description",
    });

    expect(container.querySelector("h1")?.textContent).toBe(
      "This page doesn't exist",
    );
    expect(container.textContent).toContain("Custom description");
    expect(buttons()).toEqual([]);
  });

  it("sends a signed-out visitor to sign-in, which returns to the link", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render({ state: "signed-out" });

    expect(container.querySelector("h1")?.textContent).toBe(
      "Sign in to continue",
    );
    const signIn = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Sign in",
    );
    act(() => signIn?.click());
    expect(assign).toHaveBeenCalledWith("/_agent-native/sign-in");
  });

  it("can be the page's main landmark", () => {
    render({ state: "trashed", landmark: true });

    expect(container.querySelector("main")?.dataset.accessState).toBe(
      "trashed",
    );
    expect(container.querySelector("h1")?.textContent).toBe(
      "This is in the trash",
    );
  });

  it("translates its own strings", async () => {
    render({ state: "denied", signedInEmail: "a@example.test" }, "de-DE");

    await vi.waitFor(() => {
      expect(container.querySelector("h1")?.textContent).toBe(
        "Du hast keinen Zugriff",
      );
    });
    expect(container.textContent).toContain(
      "Du bist als a@example.test angemeldet",
    );
  });
});

// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DesktopIdentityGate from "./DesktopIdentityGate.js";

describe("DesktopIdentityGate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("offers account creation and sign-in on the first eligible app", () => {
    const onSignIn = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DesktopIdentityGate
          appName="Mail"
          status="sign-in-required"
          onSignIn={onSignIn}
        />,
      );
    });

    expect(container.textContent).toContain("Sign in once to open your workspace");
    expect(container.textContent).toContain("Continue with Google or magic link");
    container
      .querySelector(".desktop-identity-gate__provider")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("renders the parent-owned credential form", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DesktopIdentityGate
          appName="Mail"
          status="sign-in-required"
          onSignIn={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("keeps the app covered while the isolated Electron ceremony is open", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DesktopIdentityGate
          appName="Mail"
          status="signing-in"
          onSignIn={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Opening your workspace");
    expect(container.querySelector("button")).toBeNull();
  });

  it("blocks the app while the shared identity status is being checked", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DesktopIdentityGate
          appName="Mail"
          status="checking"
          onSignIn={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Checking your Agent Native account",
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders nothing after the broker has fanned out app sessions", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        <DesktopIdentityGate
          appName="Mail"
          status="signed-in"
          onSignIn={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toBe("");
  });
});

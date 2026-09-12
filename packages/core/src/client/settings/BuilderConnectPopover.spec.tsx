// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n.js", () => ({
  useT: () => (_key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? _key,
}));

import { BuilderConnectPopover } from "./BuilderConnectPopover.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function connectButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    "[data-testid='connect-builder']",
  );
  if (!button) throw new Error("connect trigger not rendered");
  return button;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

function render(node: React.ReactElement) {
  act(() => root.render(node));
}

function trigger() {
  return React.createElement("button", {
    type: "button",
    "data-testid": "connect-builder",
  });
}

/**
 * The first Builder status read is a network round trip, and on a cold
 * serverless instance it can take seconds. Every "Connect Builder.io" surface
 * renders this trigger as a normal, enabled-looking button for that whole
 * window. Dropping the click there is indistinguishable from a broken button:
 * nothing opens, nothing spins, and nothing explains why.
 */
describe("BuilderConnectPopover before the status read resolves", () => {
  it("runs the connect intent once the capability resolves", () => {
    const onConnect = vi.fn();
    const retry = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry,
      statusResolved: false,
      agentNativeProvisioningEnabled: false,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        { flow, onConnect },
        trigger(),
      ),
    );

    click(connectButton());

    // Re-reading status on an unresolved click is correct and must stay.
    expect(retry).toHaveBeenCalledTimes(1);

    // The status read lands a moment later with provisioning unavailable, so
    // the resolved behavior for this click is the direct connect path.
    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: { ...flow, statusResolved: true },
          onConnect,
        },
        trigger(),
      ),
    );

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(false);
  });

  it("opens the consent popover when the resolved capability offers provisioning", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(),
      statusResolved: false,
      agentNativeProvisioningEnabled: false,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        { flow, onConnect, contentTestId: "consent" },
        trigger(),
      ),
    );

    click(connectButton());

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: {
            ...flow,
            statusResolved: true,
            agentNativeProvisioningEnabled: true,
          },
          onConnect,
          contentTestId: "consent",
        },
        trigger(),
      ),
    );

    // Provisioning is a consent decision, so the pending click must surface
    // the choice rather than silently picking one.
    expect(onConnect).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='consent']")).not.toBeNull();
  });

  it("releases the queued click when the status read itself fails", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(),
      statusResolved: false,
      agentNativeProvisioningEnabled: false,
      error: null as string | null,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        { flow, onConnect },
        trigger(),
      ),
    );

    click(connectButton());
    expect(connectButton().getAttribute("aria-busy")).toBe("true");

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: {
            ...flow,
            error: "Couldn't reach Builder to check your account. Retrying.",
          },
          onConnect,
        },
        trigger(),
      ),
    );

    // An unreadable status is not a resolved capability: guessing a connect
    // path here is how a failure gets reported as a normal flow.
    expect(onConnect).not.toHaveBeenCalled();
    expect(connectButton().getAttribute("aria-busy")).toBeNull();
  });

  it("does not replay a pending click that the user never made", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(),
      statusResolved: false,
      agentNativeProvisioningEnabled: false,
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        { flow, onConnect },
        trigger(),
      ),
    );

    render(
      React.createElement(
        BuilderConnectPopover,
        { flow: { ...flow, statusResolved: true }, onConnect },
        trigger(),
      ),
    );

    expect(onConnect).not.toHaveBeenCalled();
  });
});

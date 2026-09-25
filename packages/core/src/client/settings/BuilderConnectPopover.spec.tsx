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
  it("never replays a queued click into the popup path", () => {
    // `flow.start` reaches `window.open`, which only survives inside the click
    // that asked for it. Replaying it from an effect would swap a dead button
    // for a blocked popup and an "allow popups" message blaming the user.
    const onConnect = vi.fn();
    const retry = vi.fn(() => true);
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry,
      statusResolved: false,
      statusReadSettledCount: 0,
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
    expect(connectButton().getAttribute("aria-busy")).toBe("true");

    // The read resolves with provisioning unavailable, so the only honest
    // answer needs a popup. Release the intent; the resolved trigger answers
    // the next real click synchronously.
    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: { ...flow, statusResolved: true, statusReadSettledCount: 1 },
          onConnect,
        },
        trigger(),
      ),
    );

    expect(onConnect).not.toHaveBeenCalled();
    expect(flow.start).not.toHaveBeenCalled();
    expect(connectButton().getAttribute("aria-busy")).toBeNull();

    // The next click is a real gesture and goes straight through.
    click(connectButton());
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(false);
  });

  it("opens the consent popover when the resolved capability offers provisioning", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(() => true),
      statusResolved: false,
      statusReadSettledCount: 0,
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
            statusReadSettledCount: 1,
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

  it("releases the queued click when the read it triggered settles unresolved", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(() => true),
      statusResolved: false,
      statusReadSettledCount: 0,
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
    expect(connectButton().getAttribute("aria-busy")).toBe("true");

    // The read came back and still did not resolve the capability. Guessing a
    // connect path here is how a failure gets reported as a normal flow, and
    // holding the intent would leave the trigger busy forever.
    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: { ...flow, statusReadSettledCount: 1 },
          onConnect,
        },
        trigger(),
      ),
    );

    expect(onConnect).not.toHaveBeenCalled();
    expect(connectButton().getAttribute("aria-busy")).toBeNull();
  });

  it("keeps a click queued across a retry that started from a prior failure", () => {
    // A trigger clicked while an earlier read error is already on screen must
    // still honour the retry it kicks off. Keying the release on the error
    // string would cancel this intent before the retry could land.
    const onConnect = vi.fn();
    const retry = vi.fn(() => true);
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry,
      statusResolved: false,
      statusReadSettledCount: 3,
      agentNativeProvisioningEnabled: false,
      error: "Couldn't reach Builder to check your account. Retrying.",
    };

    render(
      React.createElement(
        BuilderConnectPopover,
        { flow, onConnect, contentTestId: "consent" },
        trigger(),
      ),
    );

    click(connectButton());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(connectButton().getAttribute("aria-busy")).toBe("true");

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: {
            ...flow,
            statusResolved: true,
            statusReadSettledCount: 4,
            agentNativeProvisioningEnabled: true,
            error: null,
          },
          onConnect,
          contentTestId: "consent",
        },
        trigger(),
      ),
    );

    expect(document.querySelector("[data-testid='consent']")).not.toBeNull();
  });

  it("does not start a second read while a click is already queued", () => {
    // The hook's newest-wins refresh drops a superseded response, so a second
    // retry can throw away a success that was about to land.
    const onConnect = vi.fn();
    const retry = vi.fn(() => true);
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry,
      statusResolved: false,
      statusReadSettledCount: 0,
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
    click(connectButton());
    click(connectButton());

    expect(retry).toHaveBeenCalledTimes(1);

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: {
            ...flow,
            statusResolved: true,
            statusReadSettledCount: 1,
            agentNativeProvisioningEnabled: true,
          },
          onConnect,
          contentTestId: "consent",
        },
        trigger(),
      ),
    );

    expect(document.querySelector("[data-testid='consent']")).not.toBeNull();
  });

  it("does not queue against a flow that cannot start a read", () => {
    // A disabled flow never reads, so `statusResolved` stays false forever.
    // Queuing there would leave the trigger busy for the rest of the session.
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(() => false),
      statusResolved: false,
      statusReadSettledCount: 0,
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

    expect(flow.retry).toHaveBeenCalledTimes(1);
    expect(connectButton().getAttribute("aria-busy")).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("releases a queued click when the flow resets its settle counter", () => {
    // Disabling the flow cancels the in-flight read and zeroes the counter. A
    // snapshot taken above that reset is never exceeded again, so an
    // increment-only comparison would leave the trigger busy for good.
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(() => true),
      statusResolved: false,
      statusReadSettledCount: 4,
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
    expect(connectButton().getAttribute("aria-busy")).toBe("true");

    render(
      React.createElement(
        BuilderConnectPopover,
        {
          flow: { ...flow, statusReadSettledCount: 0 },
          onConnect,
        },
        trigger(),
      ),
    );

    expect(connectButton().getAttribute("aria-busy")).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
    expect(flow.start).not.toHaveBeenCalled();
  });

  it("does not replay a pending click that the user never made", () => {
    const onConnect = vi.fn();
    const flow = {
      connecting: false,
      start: vi.fn(),
      retry: vi.fn(() => true),
      statusResolved: false,
      statusReadSettledCount: 0,
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
        {
          flow: { ...flow, statusResolved: true, statusReadSettledCount: 1 },
          onConnect,
        },
        trigger(),
      ),
    );

    expect(onConnect).not.toHaveBeenCalled();
  });
});

it("shows a cancel action while the Builder connection is waiting", () => {
  const cancel = vi.fn();
  render(
    React.createElement(
      BuilderConnectPopover,
      {
        flow: {
          connecting: true,
          start: vi.fn(),
          cancel,
          statusResolved: true,
          agentNativeProvisioningEnabled: false,
        },
      },
      trigger(),
    ),
  );

  const buttons = container.querySelectorAll("button");
  expect(buttons).toHaveLength(2);
  expect(buttons[1]?.textContent).toBe("common.cancel");
  click(buttons[1]!);
  expect(cancel).toHaveBeenCalledTimes(1);
});

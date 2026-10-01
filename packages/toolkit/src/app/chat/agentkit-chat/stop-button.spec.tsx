// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAgentKitStopButton } from "./stop-button.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  activeRunIds: [] as string[],
  cancel: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("../../agentkit/react/context.js", () => ({
  useAgentThread: () => ({ activeRunIds: mocks.activeRunIds }),
  useAgentKitControl: () => ({ cancel: mocks.cancel }),
}));

const onError = vi.fn();

function Harness() {
  return <>{useAgentKitStopButton({ onError })}</>;
}

describe("useAgentKitStopButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    mocks.cancel.mockReset();
    mocks.cancel.mockResolvedValue(undefined);
    onError.mockClear();
  });

  async function render() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  }

  it("renders nothing while no run is active", async () => {
    mocks.activeRunIds = [];
    await render();
    expect(container.querySelector("button")).toBeNull();
  });

  it("stops every active run when clicked", async () => {
    mocks.activeRunIds = ["run-1", "run-2"];
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    expect(button?.getAttribute("aria-label")).toBe(
      "agentChat.composer.stopResponse",
    );
    await act(async () => button!.click());
    expect(mocks.cancel).toHaveBeenCalledTimes(2);
    expect(mocks.cancel).toHaveBeenCalledWith("run-1");
    expect(mocks.cancel).toHaveBeenCalledWith("run-2");
  });

  it("reports a failed stop instead of dropping it", async () => {
    mocks.activeRunIds = ["run-1"];
    mocks.cancel.mockRejectedValue(new Error("cancel refused"));
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    await act(async () => button!.click());
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]![0]).toMatchObject({
      message: "cancel refused",
    });
  });
});

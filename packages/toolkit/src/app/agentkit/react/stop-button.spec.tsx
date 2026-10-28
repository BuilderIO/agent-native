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
  runs: {} as Record<string, { status: string }>,
  cancel: vi.fn(async () => undefined),
}));

vi.mock("./context.js", () => ({
  useAgentThread: () => ({
    activeRunIds: mocks.activeRunIds,
    runs: mocks.runs,
    events: [],
  }),
  useAgentKitControl: () => ({ cancel: mocks.cancel }),
  useAgentKitSubmissionStarting: () => false,
}));

const onError = vi.fn();
let beforeCancel: (() => boolean | Promise<boolean>) | undefined;

function Harness() {
  return (
    <>
      {useAgentKitStopButton({ label: "Stop response", onError, beforeCancel })}
    </>
  );
}

describe("useAgentKitStopButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    mocks.runs = {};
    await act(async () => root?.unmount());
    container?.remove();
    mocks.cancel.mockReset();
    mocks.cancel.mockResolvedValue(undefined);
    onError.mockClear();
    beforeCancel = undefined;
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

  it("sizes Stop like Send from the shared composer token", async () => {
    mocks.activeRunIds = ["run-1"];
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    expect(button?.className).toContain(
      "size-[var(--agentkit-composer-primary-control-size,2rem)]",
    );
  });

  it("steps down to secondary only while Send sits beside it", async () => {
    mocks.activeRunIds = ["run-1"];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const row = (withSend: boolean) => (
      <div data-agent-composer-slot="toolbar">
        <div data-agent-composer-slot="stop-slot">
          <Harness />
        </div>
        {withSend ? (
          <button type="button" data-agent-composer-slot="send-button" />
        ) : null}
      </div>
    );
    await act(async () => root.render(row(false)));
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    )!;
    const variants = button.className
      .split(" ")
      .map((name) =>
        /^\[(.+)_&\]:(bg|text)-secondary(-foreground)?$/.exec(name),
      )
      .filter((match) => match !== null);
    expect(variants.map((match) => match![0])).toEqual([
      expect.stringContaining(":bg-secondary"),
      expect.stringContaining(":text-secondary-foreground"),
    ]);
    // The default fill stays primary; the variant is what swaps it.
    expect(button.className.split(" ")).toContain("bg-primary");
    const besideSend = `${variants[0]![1]} [data-agent-composer-slot="stop-button"]`;
    expect(container.querySelector(besideSend)).toBeNull();

    await act(async () => root.render(row(true)));
    expect(container.querySelector(besideSend)).toBe(button);
  });

  it("stops every active run when clicked", async () => {
    mocks.activeRunIds = ["run-1", "run-2"];
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    expect(button?.getAttribute("aria-label")).toBe("Stop response");
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

  it("issues one cancel while a stop is in flight", async () => {
    mocks.activeRunIds = ["run-1"];
    const cancelled = Promise.withResolvers<undefined>();
    mocks.cancel.mockReturnValue(cancelled.promise);
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    expect(button?.hasAttribute("title")).toBe(false);
    await act(async () => {
      button!.click();
      button!.click();
    });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute("aria-busy")).toBe("true");
    await act(async () => cancelled.resolve(undefined));
  });

  it("re-enables Stop when cancelling fails", async () => {
    mocks.activeRunIds = ["run-1"];
    mocks.cancel.mockRejectedValue(new Error("cancel refused"));
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    await act(async () => button!.click());
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute("aria-busy")).toBe(false);
  });

  it("keeps the run going when beforeCancel vetoes the stop", async () => {
    mocks.activeRunIds = ["run-1"];
    beforeCancel = vi.fn(async () => false);
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    await act(async () => button!.click());
    expect(beforeCancel).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(button?.disabled).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancels after beforeCancel allows the stop", async () => {
    mocks.activeRunIds = ["run-1"];
    beforeCancel = vi.fn(() => true);
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    await act(async () => button!.click());
    expect(mocks.cancel).toHaveBeenCalledWith("run-1");
  });

  it("reports a beforeCancel failure and re-enables Stop", async () => {
    mocks.activeRunIds = ["run-1"];
    beforeCancel = vi.fn(async () => {
      throw new Error("Stop unavailable");
    });
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    await act(async () => button!.click());
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]![0]).toMatchObject({
      message: "Stop unavailable",
    });
    expect(button?.disabled).toBe(false);
  });

  it("re-enables Stop once the cancel settles while the run still shows active", async () => {
    mocks.activeRunIds = ["run-1"];
    const cancelled = Promise.withResolvers<undefined>();
    mocks.cancel.mockReturnValue(cancelled.promise);
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      '[data-agent-composer-slot="stop-button"]',
    );
    await act(async () => button!.click());
    expect(button?.disabled).toBe(true);
    await act(async () => cancelled.resolve(undefined));
    expect(button?.disabled).toBe(false);
    expect(button?.hasAttribute("aria-busy")).toBe(false);
  });

  it("enables Stop for a run that starts while the previous cancel is in flight", async () => {
    mocks.activeRunIds = ["run-1"];
    const cancelled = Promise.withResolvers<undefined>();
    mocks.cancel.mockReturnValue(cancelled.promise);
    await render();
    const button = () =>
      container.querySelector<HTMLButtonElement>(
        '[data-agent-composer-slot="stop-button"]',
      );
    await act(async () => button()!.click());
    expect(button()?.disabled).toBe(true);

    mocks.activeRunIds = ["run-2"];
    await act(async () => root.render(<Harness />));
    expect(button()?.disabled).toBe(false);
    mocks.cancel.mockResolvedValue(undefined);
    await act(async () => button()!.click());
    expect(mocks.cancel).toHaveBeenLastCalledWith("run-2");
    await act(async () => cancelled.resolve(undefined));
  });

  it("hides Stop once every retained run is terminal", async () => {
    mocks.activeRunIds = ["run-1"];
    mocks.runs = { "run-1": { status: "completed" } };
    await render();
    expect(container.querySelector("button")).toBeNull();
  });
});

// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ callAction: vi.fn(), track: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mocks.callAction(...args),
}));
vi.mock("@/lib/design-relay-tracking", () => ({
  trackDesignRelay: (...args: unknown[]) => mocks.track(...args),
}));

import { DesignFirstOutputNextStep } from "./first-output-next-step.js";

let container: HTMLDivElement;
let root: Root;
const labels = {
  ariaLabel: "Next steps",
  refineWithPrompt: "Refine with a prompt",
  export: "Export",
  shareLink: "Share link",
  dismiss: "Dismiss",
};

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  mocks.callAction.mockReset();
  mocks.track.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(actionsAvailable = true) {
  await act(async () => {
    root.render(
      <DesignFirstOutputNextStep
        outputId="design-1"
        userScope="user-1"
        generationActive={false}
        outputReady
        actionsAvailable={actionsAvailable}
        labels={labels}
        onRefine={vi.fn()}
        onExport={vi.fn()}
        onShareLink={vi.fn()}
      />,
    );
  });
}

async function ready(designId = "design-1") {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent("design:verified-generation-ready", {
        detail: { designId, runId: "run-1", turnId: "turn-1" },
      }),
    );
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("Design first-output next steps", () => {
  it("enrolls a completed output and shows and tracks the treatment", async () => {
    mocks.callAction.mockResolvedValue({ variant: "next_step" });
    await render();
    expect(document.querySelector("[data-first-output-next-step]")).toBeNull();
    await ready("another-design");
    expect(mocks.callAction).not.toHaveBeenCalled();
    await ready();
    expect(mocks.callAction).toHaveBeenCalledWith(
      "enroll-first-output-experiment",
      {
        outputId: "design-1",
        runId: "run-1",
        turnId: "turn-1",
      },
      { uiOnly: true },
    );
    const bar = document.querySelector("[data-first-output-next-step]");
    expect(bar).not.toBeNull();
    expect(mocks.track).toHaveBeenCalledWith("first_output_next_step_shown", {
      app_id: "design",
      output_id: "design-1",
    });
    const refine = Array.from(bar!.querySelectorAll("button")).find(
      (button) => button.textContent === labels.refineWithPrompt,
    );
    await act(async () => refine!.click());
    expect(mocks.track).toHaveBeenCalledWith("first_output_next_step_clicked", {
      app_id: "design",
      output_id: "design-1",
      action: "refine",
    });
  });

  it("enrolls the control group without showing the bar", async () => {
    mocks.callAction.mockResolvedValue({ variant: "control" });
    await render();
    await ready();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-first-output-next-step]")).toBeNull();
    expect(mocks.track).not.toHaveBeenCalledWith(
      "first_output_next_step_shown",
      expect.anything(),
    );
    expect(mocks.track).toHaveBeenCalledWith("design_experiment_editor_visit", {
      output_id: "design-1",
    });
  });

  it("recovers a lost enrollment response and shows treatment", async () => {
    vi.useFakeTimers();
    try {
      mocks.callAction
        .mockRejectedValueOnce(new Error("lost response"))
        .mockResolvedValueOnce({ variant: "next_step" });
      await render();
      await ready();
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(mocks.callAction).toHaveBeenCalledTimes(2);
      expect(
        document.querySelector("[data-first-output-next-step]"),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not enroll until actions are available", async () => {
    mocks.callAction.mockResolvedValue({ variant: "next_step" });
    await render(false);
    await ready();
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(document.querySelector("[data-first-output-next-step]")).toBeNull();
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { HomeContextBanner } from "./context-banner";

const progress = {
  enabled: true,
  progressPercent: 33,
  completedSteps: ["connect", "endorse"] as const,
  canDismiss: false,
};

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return { container, root };
}

it("renders nothing when no step navigation is supplied, rather than dead buttons", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { container, root } = render(
    <HomeContextBanner progress={{ ...progress, completedSteps: [] }} />,
  );
  try {
    expect(container.innerHTML).toBe("");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("links every step through the supplied handler and omits a dismiss nobody backs", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onSelectStep = vi.fn();
  const { container, root } = render(
    <HomeContextBanner
      progress={{ ...progress }}
      onSelectStep={onSelectStep}
    />,
  );
  try {
    const steps = [...container.querySelectorAll(".ws-home-curate-step")];
    expect(steps.map((step) => step.textContent)).toEqual([
      "Connect",
      "Endorse",
      "Improve",
      "Reference",
      "Extend",
      "Govern",
    ]);
    expect(steps.every((step) => !step.hasAttribute("disabled"))).toBe(true);
    act(() => (steps[2] as HTMLButtonElement).click());
    expect(onSelectStep).toHaveBeenCalledWith("improve");
    expect(container.querySelector(".ws-home-curate-dismiss")).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it("keeps a dismiss control when the caller supplies one", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const onDismiss = vi.fn();
  const { container, root } = render(
    <HomeContextBanner
      progress={{ ...progress, canDismiss: true }}
      onSelectStep={() => {}}
      onDismiss={onDismiss}
    />,
  );
  try {
    const dismiss = container.querySelector<HTMLButtonElement>(
      ".ws-home-curate-dismiss",
    );
    if (!dismiss) throw Error("Dismiss control missing");
    expect(dismiss.getAttribute("aria-label")).toBe("Dismiss");
    expect(dismiss.hasAttribute("disabled")).toBe(false);
    act(() => dismiss.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

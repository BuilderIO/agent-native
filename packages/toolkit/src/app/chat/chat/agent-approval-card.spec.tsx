// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentApprovalCard } from "./agent-approval-card.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: Partial<Parameters<typeof AgentApprovalCard>[0]>) {
  const handlers = {
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onAlwaysAllow: vi.fn(),
  };
  act(() =>
    root.render(
      <AgentApprovalCard
        toolName="delete_branches"
        question="Delete 14 branches?"
        approveLabel="Approve"
        denyLabel="Deny"
        moreOptionsLabel="More options"
        alwaysAllowLabel="Always allow"
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === label ||
      candidate.getAttribute("aria-label") === label,
  );
  expect(found).toBeDefined();
  return found!;
}

describe("AgentApprovalCard", () => {
  it("renders on the shared ApprovalCard and denies in one click", () => {
    const handlers = render({});
    expect(container.querySelector(".agentkit-approval")).not.toBeNull();
    act(() => button("Deny").click());
    expect(handlers.onDeny).toHaveBeenCalledTimes(1);
    expect(handlers.onApprove).not.toHaveBeenCalled();
  });

  it("splits Always allow off Approve only when it is offered", () => {
    render({});
    expect(button("More options")).toBeDefined();
    render({ onAlwaysAllow: undefined });
    expect(
      [...container.querySelectorAll("button")].some(
        (candidate) => candidate.getAttribute("aria-label") === "More options",
      ),
    ).toBe(false);
  });

  it("disables every action while Always allow saves and shows a save failure", () => {
    render({ isAlwaysAllowing: true, saveFailedLabel: "Couldn't save" });
    expect(button("Approve").disabled).toBe(true);
    expect(button("Deny").disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Couldn't save",
    );
  });
});

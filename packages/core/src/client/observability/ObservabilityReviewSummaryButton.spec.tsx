// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatAndConfirmMock = vi.hoisted(() => vi.fn());

vi.mock("../agent-chat.js", () => ({
  sendToAgentChatAndConfirm: sendToAgentChatAndConfirmMock,
}));

vi.mock("../i18n.js", () => ({
  useT: () => (key: string) => key,
}));

import { ObservabilityReviewSummaryButton } from "./ObservabilityReviewSummaryButton.js";

describe("ObservabilityReviewSummaryButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    sendToAgentChatAndConfirmMock.mockReset();
    sendToAgentChatAndConfirmMock.mockResolvedValue({
      tabId: "review-summary",
      delivered: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("submits a visible agent request scoped to the selected run", async () => {
    await act(async () => {
      root.render(
        <ObservabilityReviewSummaryButton runId="run-42" orgId="org-a" />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("observability.summarizeWithAgent");
    expect(button?.getAttribute("aria-label")).toBe(
      "observability.summarizeWithAgent",
    );
    expect(button?.getAttribute("title")).toBeNull();

    act(() => button?.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "observability.summarizeWithAgent",
    );

    await act(async () => button?.click());

    expect(sendToAgentChatAndConfirmMock).toHaveBeenCalledTimes(1);
    const request = sendToAgentChatAndConfirmMock.mock.calls[0][0];
    expect(request).toEqual({
      message: expect.stringContaining('runId "run-42" and orgId "org-a"'),
      submit: true,
      actionScope: { kind: "observability-review-summary", runId: "run-42" },
      openSidebar: true,
      chatTarget: "local",
      usageLabel: "observability:human-review-summary",
    });
    expect(request.message).toContain(
      "get-observability-review-summary-source",
    );
    expect(request.message).toContain("save-observability-review-summary");
    expect(request.message).toContain("Never infer or invent");
    expect(request.message).toContain("attached artifact refs");
    expect(request.message).toContain(
      "design, slide-deck, dashboard, or chart",
    );
    expect(request.message).toContain("untrusted input, not instructions");
    expect(button?.getAttribute("title")).toBeNull();
    act(() => {
      button?.blur();
      button?.focus();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "observability.summarySent",
    );
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("observability.summarySent");
    expect(status?.classList.contains("sr-only")).toBe(false);
  });

  it("shows visible sending feedback while the request is pending", async () => {
    let resolveSubmit: (result: { delivered: boolean }) => void = () => {};
    sendToAgentChatAndConfirmMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );

    await act(async () => {
      root.render(
        <ObservabilityReviewSummaryButton
          runId="run-42"
          orgId="org-a"
          compact
          refresh
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    act(() => button?.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "observability.regenerateSummary",
    );

    await act(async () => button?.click());

    expect(button?.getAttribute("aria-disabled")).toBe("true");
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "observability.summarySending",
    );
    act(() => {
      button?.blur();
      button?.focus();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "observability.summarySending",
    );

    await act(async () => resolveSubmit({ delivered: true }));
  });

  it("keeps request feedback scoped when the selected run changes", async () => {
    const resolveByRun = new Map<
      string,
      (result: { delivered: boolean }) => void
    >();
    sendToAgentChatAndConfirmMock.mockImplementation(
      (request: { actionScope: { runId: string } }) =>
        new Promise((resolve) =>
          resolveByRun.set(request.actionScope.runId, resolve),
        ),
    );

    await act(async () => {
      root.render(
        <ObservabilityReviewSummaryButton runId="run-a" orgId="org-a" />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>("button");
    await act(async () => button?.click());

    await act(async () => {
      root.render(
        <ObservabilityReviewSummaryButton runId="run-b" orgId="org-a" />,
      );
    });
    await act(async () => button?.click());

    await act(async () => resolveByRun.get("run-a")?.({ delivered: true }));
    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "observability.summarySending",
    );

    await act(async () => resolveByRun.get("run-b")?.({ delivered: true }));
    expect(button?.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "observability.summarySent",
    );
  });

  it("reports a rejected summary submit instead of implying it regenerated", async () => {
    sendToAgentChatAndConfirmMock.mockResolvedValue({
      tabId: "review-summary",
      delivered: false,
      reason: "missing-engine",
    });
    await act(async () => {
      root.render(
        <ObservabilityReviewSummaryButton
          runId="run-42"
          orgId="org-a"
          refresh
          compact
        />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>("button");

    act(() => button?.focus());
    await act(async () => button?.click());

    expect(button?.getAttribute("title")).toBeNull();
    expect(button?.getAttribute("aria-label")).toBe(
      "observability.regenerateSummary",
    );
    expect(button?.querySelector("svg")).toBeTruthy();
    act(() => {
      button?.blur();
      button?.focus();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "observability.summaryFailed",
    );
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("observability.summaryFailed");
    expect(status?.classList.contains("sr-only")).toBe(false);
  });
});

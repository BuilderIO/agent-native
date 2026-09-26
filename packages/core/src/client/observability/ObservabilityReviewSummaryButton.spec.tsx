// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendToAgentChatMock = vi.hoisted(() => vi.fn());

vi.mock("../agent-chat.js", () => ({
  sendToAgentChat: sendToAgentChatMock,
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
    sendToAgentChatMock.mockReset();
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
      root.render(<ObservabilityReviewSummaryButton runId="run-42" />);
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("observability.summarizeWithAgent");

    await act(async () => button?.click());

    expect(sendToAgentChatMock).toHaveBeenCalledTimes(1);
    const request = sendToAgentChatMock.mock.calls[0][0];
    expect(request).toEqual({
      message: expect.stringContaining('runId "run-42"'),
      submit: true,
      actionScope: { kind: "observability-review-summary", runId: "run-42" },
      openSidebar: true,
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
  });
});

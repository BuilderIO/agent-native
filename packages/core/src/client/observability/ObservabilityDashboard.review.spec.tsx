// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockOutputReviews, mockSubmitFeedback, mockSaveInstructionUpdate } =
  vi.hoisted(() => ({
    mockOutputReviews: vi.fn(),
    mockSubmitFeedback: vi.fn(),
    mockSaveInstructionUpdate: vi.fn(),
  }));

vi.mock("./useObservability.js", () => ({
  useObservabilityOverview: () => ({
    data: {
      totalRuns: 1,
      totalCostCents: 0,
      avgDurationMs: 0,
      toolSuccessRate: 1,
      thumbsUpRate: 0,
      avgEvalScore: 1,
    },
    isLoading: false,
  }),
  useTraces: vi.fn(),
  useTraceDetail: vi.fn(),
  useFeedbackList: vi.fn(),
  useFeedbackStats: vi.fn(),
  useSatisfaction: vi.fn(),
  useEvalStats: vi.fn(),
  useExperiments: vi.fn(),
  useExperimentDetail: vi.fn(),
  useExperimentResults: vi.fn(),
  useOutputReviews: () => mockOutputReviews(),
  useSaveInstructionUpdate: () => ({
    mutate: mockSaveInstructionUpdate,
    isPending: false,
  }),
  useSubmitFeedback: () => ({ mutate: mockSubmitFeedback, isPending: false }),
}));

import { AgentNativeI18nProvider } from "../i18n.js";
import { ObservabilityDashboard } from "./ObservabilityDashboard.js";

describe("ObservabilityDashboard human review", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockOutputReviews.mockReturnValue({
      isLoading: false,
      data: [
        {
          runId: "run-1",
          threadId: "thread-1",
          ask: "Design a compact analytics view",
          answer: "Sessions grew 18% this week.",
          model: "test-model",
          createdAt: Date.now(),
          feedback: [
            {
              id: "vote-1",
              feedbackType: "thumbs_down",
              value: "",
              createdAt: 2,
            },
            {
              id: "note-1",
              feedbackType: "text",
              value: "Keep the chart inline.",
              createdAt: 1,
            },
          ],
          instructionUpdate: null,
        },
      ],
    });
    mockSubmitFeedback.mockImplementation((_input, callbacks) =>
      callbacks?.onSuccess?.(),
    );
    mockSaveInstructionUpdate.mockImplementation((_input, callbacks) =>
      callbacks?.onSuccess?.(),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows output inline with compact, accessible thumbs controls", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider persistPreference={false}>
            <ObservabilityDashboard />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });

    const reviewTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Human review"),
    );
    expect(reviewTab).toBeTruthy();
    await act(async () => reviewTab?.click());

    expect(container.textContent).toContain("Design a compact analytics view");
    expect(container.textContent).toContain("Sessions grew 18% this week.");
    expect(container.textContent).toContain("Keep the chart inline.");
    expect(
      container
        .querySelector('[aria-label="Thumbs down"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container
        .querySelector('[aria-label="Thumbs up"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(container.textContent).not.toContain("Review output");
    expect(container.textContent).not.toContain("Preview output");
    expect(container.textContent).not.toContain("What was asked");
    expect(container.textContent).not.toContain("What the agent answered");
  });
});

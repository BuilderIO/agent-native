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
  useOutputReviewApp: (runId: string | null) => ({
    data:
      runId === "run-2"
        ? {
            serverId: "slides",
            toolName: "render",
            originalToolName: "render",
            resourceUri: "ui://slides/render",
            toolInput: {},
            toolResult: {},
            resource: {
              uri: "ui://slides/render",
              mimeType: "text/html;profile=mcp-app",
              text: "<html><body>Saved slide preview</body></html>",
            },
          }
        : undefined,
  }),
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
        {
          runId: "run-2",
          threadId: null,
          ask: "Make a slide from the campaign results",
          answer: "Campaign response increased 24%.",
          model: "test-model",
          createdAt: Date.now() - 1,
          feedback: [],
          instructionUpdate: null,
          hasInlineApp: true,
          inlineAppTitle: "render",
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

  it("shows compact review thumbnails, then full output and thumbs feedback on demand", async () => {
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

    expect(container.querySelectorAll("[data-review-run-id]")).toHaveLength(2);
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      container.querySelector('[data-preview-kind="text"]'),
    ).not.toBeNull();
    const reviewRow = container.querySelector<HTMLButtonElement>(
      '[data-review-run-id="run-1"]',
    );
    expect(reviewRow?.textContent).toContain("Design a compact analytics view");
    expect(reviewRow?.textContent).not.toContain("Keep the chart inline.");

    await act(async () => reviewRow?.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Design a compact analytics view");
    expect(dialog?.textContent).toContain("Sessions grew 18% this week.");
    expect(dialog?.textContent).toContain("Keep the chart inline.");
    expect(
      dialog
        .querySelector('[aria-label="Thumbs down"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      dialog
        .querySelector('[aria-label="Thumbs up"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    await act(async () =>
      dialog?.querySelector('[aria-label="Thumbs up"]')?.click(),
    );
    expect(mockSubmitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", feedbackType: "thumbs_up" }),
      expect.any(Object),
    );
  });

  it("keeps notes scoped to their review and allows instruction drafts without a thread", async () => {
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
    await act(async () => reviewTab?.click());
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-review-run-id="run-1"]')
        ?.click(),
    );

    let dialog = document.body.querySelector('[role="dialog"]');
    await act(async () =>
      dialog?.querySelector('[aria-label="Add feedback"]')?.click(),
    );
    const feedbackInput = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="What should change or stay the same?"]',
    );
    expect(feedbackInput).not.toBeNull();
    await act(async () => {
      if (!feedbackInput) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(feedbackInput, "Only for the first review");
      feedbackInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () =>
      dialog?.querySelector('[aria-label="Close"]')?.click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-review-run-id="run-2"]')
        ?.click(),
    );

    dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("iframe")).not.toBeNull();
    await act(async () =>
      dialog?.querySelector('[aria-label="Add feedback"]')?.click(),
    );
    const secondFeedbackInput =
      document.body.querySelector<HTMLTextAreaElement>(
        'textarea[placeholder="What should change or stay the same?"]',
      );
    expect(secondFeedbackInput?.value).toBe("");
    await act(async () =>
      dialog?.querySelector('[aria-label="Add feedback"]')?.click(),
    );
    await act(async () =>
      dialog?.querySelector('[aria-label="Draft instruction"]')?.click(),
    );
    const instructionInput = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Write the instruction change for a human to review."]',
    );
    expect(instructionInput).not.toBeNull();
    await act(async () => {
      if (!instructionInput) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(instructionInput, "Keep the slide title concise");
      instructionInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Save draft update"));
    await act(async () => saveButton?.click());
    expect(mockSaveInstructionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-2",
        threadId: null,
        instruction: "Keep the slide title concise",
      }),
      expect.any(Object),
    );
  });

  it("keeps a newer row's drafts open when an earlier save completes", async () => {
    let finishFeedbackA: (() => void) | undefined;
    let finishInstructionA: (() => void) | undefined;
    mockSubmitFeedback.mockImplementation((_input, callbacks) => {
      finishFeedbackA = () => callbacks?.onSuccess?.();
    });
    mockSaveInstructionUpdate.mockImplementation((_input, callbacks) => {
      finishInstructionA = () => callbacks?.onSuccess?.();
    });

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
    await act(async () => reviewTab?.click());

    const openRun = async (runId: string) => {
      const closeButton = document.body.querySelector<HTMLButtonElement>(
        '[role="dialog"] [aria-label="Close"]',
      );
      if (closeButton) {
        await act(async () => closeButton.click());
      }
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(`[data-review-run-id="${runId}"]`)
          ?.click();
      });
    };
    const setText = async (input: HTMLTextAreaElement, value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-review-run-id="run-1"]')
        ?.click(),
    );
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Add feedback"]')
        ?.click(),
    );
    let input = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="What should change or stay the same?"]',
    );
    expect(input).not.toBeNull();
    await setText(input!, "Feedback for A");
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Save feedback"))
        ?.click();
    });

    await openRun("run-2");
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Add feedback"]')
        ?.click(),
    );
    input = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="What should change or stay the same?"]',
    );
    expect(input).not.toBeNull();
    await setText(input!, "Feedback for B");
    await act(async () => finishFeedbackA?.());
    expect(input?.value).toBe("Feedback for B");

    await openRun("run-1");
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Draft instruction"]')
        ?.click(),
    );
    input = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Write the instruction change for a human to review."]',
    );
    expect(input).not.toBeNull();
    await setText(input!, "Instruction for A");
    await act(async () => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Save draft update"))
        ?.click();
    });

    await openRun("run-2");
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Draft instruction"]')
        ?.click(),
    );
    input = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Write the instruction change for a human to review."]',
    );
    expect(input).not.toBeNull();
    await setText(input!, "Instruction for B");
    await act(async () => finishInstructionA?.());
    expect(input?.value).toBe("Instruction for B");
  });
});

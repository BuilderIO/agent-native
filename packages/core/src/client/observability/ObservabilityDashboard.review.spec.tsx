// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockOutputReviews,
  mockOutputReviewDetail,
  mockSubmitFeedback,
  mockSaveInstructionUpdate,
  mockSendToAgentChat,
  mockTraces,
  mockTraceDetail,
  mockOpenThread,
} = vi.hoisted(() => ({
  mockOutputReviews: vi.fn(),
  mockOutputReviewDetail: vi.fn(),
  mockSubmitFeedback: vi.fn(),
  mockSaveInstructionUpdate: vi.fn(),
  mockSendToAgentChat: vi.fn(),
  mockTraces: vi.fn(),
  mockTraceDetail: vi.fn(),
  mockOpenThread: vi.fn(),
}));

vi.mock("../agent-chat.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent-chat.js")>()),
  sendToAgentChat: mockSendToAgentChat,
  requestAgentChatThreadOpen: mockOpenThread,
}));

vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({
    data: { orgId: "org-a" },
    isLoading: false,
    isError: false,
  }),
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
  useTraces: (...args: unknown[]) => mockTraces(...args),
  useTraceDetail: (...args: unknown[]) => mockTraceDetail(...args),
  useFeedbackList: vi.fn(),
  useFeedbackStats: vi.fn(),
  useEvalStats: vi.fn(),
  useExperiments: () => ({ data: [], isLoading: false }),
  useExperimentDetail: vi.fn(),
  useExperimentResults: vi.fn(),
  useOutputReviews: () => mockOutputReviews(),
  useOutputReviewDetail: (runId: string | null) =>
    mockOutputReviewDetail(runId),
  useSaveInstructionUpdate: () => ({
    mutate: mockSaveInstructionUpdate,
    isPending: false,
  }),
  useSubmitFeedback: () => ({ mutate: mockSubmitFeedback, isPending: false }),
  useSaveReviewFeedback: () => ({
    mutate: mockSubmitFeedback,
    isPending: false,
  }),
}));

import { AgentNativeI18nProvider } from "../i18n.js";
import {
  ObservabilityDashboard,
  resolveReviewArtifactHref,
} from "./ObservabilityDashboard.js";

describe("human review artifact links", () => {
  it("keeps artifact links on the matching first-party app and environment", () => {
    expect(
      resolveReviewArtifactHref(
        "analytics",
        "dashboard-1",
        "/dashboards/dashboard-1",
        "beta.design.agent-native.com",
      ),
    ).toBe("https://beta.analytics.agent-native.com/dashboards/dashboard-1");
    expect(
      resolveReviewArtifactHref(
        "slides",
        "deck-1",
        "/deck/deck-1/present",
        "localhost",
      ),
    ).toBe("http://localhost:8086/deck/deck-1/present");
    expect(
      resolveReviewArtifactHref(
        "design",
        "design-1",
        "/present/design-1",
        "127.0.0.1",
      ),
    ).toBe("http://127.0.0.1:8099/present/design-1");
  });

  it("rejects invalid artifact paths and unknown app origins", () => {
    expect(
      resolveReviewArtifactHref(
        "design",
        "design-1",
        "https://evil.example/design/design-1",
        "design.agent-native.com",
      ),
    ).toBeUndefined();
    expect(
      resolveReviewArtifactHref(
        "analytics",
        "dashboard-1",
        "/dashboards/dashboard-1",
        "custom.example.com",
      ),
    ).toBeUndefined();
  });
});

function reviewDetail(runId: string) {
  return document.body.querySelector<HTMLElement>(
    `[data-review-detail-for="${runId}"]:not([hidden])`,
  );
}

function lightboxDialog() {
  return document.body.querySelector<HTMLElement>("[data-review-lightbox]");
}

function closeLightboxButton(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Close",
  );
}

function popoverTextarea(placeholder: string) {
  return Array.from(
    document.body.querySelectorAll<HTMLTextAreaElement>(
      `textarea[placeholder="${placeholder}"]`,
    ),
  ).at(-1);
}

function popoverButton(input: HTMLTextAreaElement, text: string) {
  const content =
    input.closest<HTMLElement>('[role="dialog"]') ??
    input.closest<HTMLElement>("[data-radix-popper-content-wrapper]");
  return Array.from(
    content?.querySelectorAll<HTMLButtonElement>("button") ?? [],
  ).find((button) => button.textContent?.includes(text));
}

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
          threadTitle: "Weekly analytics dashboard",
          summary: null,
          hasInlineApp: true,
          inlineAppTitle: "Analytics preview",
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
          threadId: "thread-2",
          ask: "Make a slide from the campaign results",
          answer: "Campaign response increased 24%.",
          threadTitle: "Campaign results slides",
          summary: null,
          model: "test-model",
          createdAt: Date.now() - 1,
          feedback: [],
          instructionUpdate: null,
          hasInlineApp: true,
          inlineAppTitle: "render",
        },
        {
          runId: "run-no-preview",
          threadId: "thread-no-preview",
          ask: "",
          answer: "-",
          threadTitle: "Thread title while preview is missing",
          summary: null,
          hasInlineApp: true,
          model: "test-model",
          createdAt: Date.now() - 2,
          feedback: [],
          instructionUpdate: null,
        },
        {
          runId: "run-no-thread",
          threadId: null,
          ask: "Background task output",
          answer: "No reviewable conversation.",
          threadTitle: "",
          summary: null,
          hasInlineApp: false,
          model: "test-model",
          createdAt: Date.now() - 2,
          feedback: [],
          instructionUpdate: null,
        },
      ],
    });
    mockOutputReviewDetail.mockImplementation((runId: string | null) => ({
      isLoading: false,
      isError: false,
      data:
        runId === "run-1"
          ? {
              app: {
                serverId: "analytics",
                toolName: "render",
                originalToolName: "render",
                resourceUri: "ui://analytics/render",
                toolInput: {},
                toolResult: {},
                resource: {
                  uri: "ui://analytics/render",
                  mimeType: "text/html;profile=mcp-app",
                  text: "<html><body>Saved analytics preview</body></html>",
                },
              },
              messages: [
                { role: "user", text: "Design a compact analytics view" },
                { role: "assistant", text: "Sessions grew 18% this week." },
                { role: "user", text: "Keep the chart inline." },
              ],
            }
          : { app: null, messages: [] },
    }));
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

  it("opens span details, the full conversation, and tab documentation", async () => {
    mockTraces.mockReturnValue({
      isLoading: false,
      data: [
        {
          runId: "run-1",
          threadId: "thread-1",
          totalSpans: 2,
          llmCalls: 1,
          toolCalls: 1,
          successfulTools: 1,
          failedTools: 0,
          totalDurationMs: 100,
          totalCostCentsX100: 0,
          totalInputTokens: 2,
          totalOutputTokens: 3,
          model: "test-model",
          createdAt: Date.now(),
        },
      ],
    });
    mockTraceDetail.mockReturnValue({
      isLoading: false,
      data: {
        summary: {
          runId: "run-1",
          threadId: "thread-1",
          totalSpans: 2,
          llmCalls: 1,
          toolCalls: 1,
          successfulTools: 1,
          failedTools: 0,
          totalDurationMs: 100,
          totalCostCentsX100: 0,
          totalInputTokens: 2,
          totalOutputTokens: 3,
          model: "test-model",
          createdAt: Date.now(),
        },
        spans: [
          {
            id: "span-success",
            runId: "run-1",
            threadId: "thread-1",
            parentSpanId: null,
            spanType: "tool_call",
            name: "search",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costCentsX100: 0,
            durationMs: 20,
            status: "success",
            errorMessage: null,
            metadata: {
              input: { query: "latest releases" },
              output: "Found 3 results",
            },
            createdAt: Date.now(),
          },
          {
            id: "span-error",
            runId: "run-1",
            threadId: "thread-1",
            parentSpanId: null,
            spanType: "tool_call",
            name: "broken-search",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costCentsX100: 0,
            durationMs: 10,
            status: "error",
            errorMessage: "Search provider returned 503",
            metadata: { input: { query: "missing results" } },
            createdAt: Date.now(),
          },
        ],
      },
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

    const experimentsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Experiments"));
    await act(async () => experimentsTab?.click());
    expect(
      container.querySelector<HTMLAnchorElement>('a[href*="#experiments"]'),
    ).toBeTruthy();

    const conversationsTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Conversations"));
    await act(async () => conversationsTab?.click());
    expect(
      container.querySelector<HTMLAnchorElement>('a[href*="#conversations"]'),
    ).toBeTruthy();

    const runRow = Array.from(container.querySelectorAll("tr")).find((row) =>
      row.textContent?.includes("run-1"),
    );
    await act(async () => (runRow as HTMLTableRowElement | undefined)?.click());

    const detailsButton = (spanName: string) =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          'button[aria-label="View details"]',
        ),
      ).find((button) => button.closest("tr")?.textContent?.includes(spanName));

    await act(async () => detailsButton("search")?.click());
    expect(container.textContent).toContain('"latest releases"');
    expect(container.textContent).toContain("Found 3 results");

    await act(async () => detailsButton("broken-search")?.click());
    expect(container.textContent).toContain("Search provider returned 503");

    await act(async () =>
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) =>
          button.textContent?.includes("Open full conversation"),
        )
        ?.click(),
    );
    expect(mockOpenThread).toHaveBeenCalledWith({ threadId: "thread-1" });
  });

  it("hides organization human review outside the admin settings surface", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider persistPreference={false}>
            <ObservabilityDashboard />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });

    expect(
      Array.from(container.querySelectorAll("a, button")).some((tab) =>
        tab.textContent?.includes("Human review"),
      ),
    ).toBe(false);
  });

  it("routes each tab and keeps Human review second", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={["/settings/observability/human-review"]}
          >
            <AgentNativeI18nProvider persistPreference={false}>
              <ObservabilityDashboard
                routeBasePath="/settings/observability"
                showHumanReview
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const tabs = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        'a[href^="/settings/observability/"]',
      ),
    );
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Overview",
      "Human review",
      "Conversations",
      "Evals",
      "Experiments",
      "Feedback",
    ]);
    expect(tabs[1]?.getAttribute("href")).toBe(
      "/settings/observability/human-review",
    );
    expect(tabs[1]?.getAttribute("aria-current")).toBe("page");
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      "/settings/observability/overview",
      "/settings/observability/human-review",
      "/settings/observability/conversations",
      "/settings/observability/evals",
      "/settings/observability/experiments",
      "/settings/observability/feedback",
    ]);
  });

  it("expands one inline row with its preview, transcript, thread link, and actions", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider persistPreference={false}>
            <ObservabilityDashboard showHumanReview />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });

    const reviewTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Human review"),
    );
    expect(reviewTab).toBeTruthy();
    await act(async () => reviewTab?.click());

    expect(container.querySelectorAll("[data-review-run-id]")).toHaveLength(3);
    expect(
      container.querySelector('[data-review-run-id="run-no-thread"]'),
    ).toBeNull();
    const noPreviewRow = container.querySelector<HTMLButtonElement>(
      '[data-review-run-id="run-no-preview"]',
    );
    expect(noPreviewRow?.textContent).toContain(
      "Thread title while preview is missing",
    );
    expect(noPreviewRow?.querySelector("[data-preview-kind]")).toBeNull();
    expect(
      container.querySelector('[data-preview-kind="app-thumbnail"]'),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-review-detail-for]:not([hidden])"),
    ).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    const reviewRow = container.querySelector<HTMLButtonElement>(
      '[data-review-run-id="run-1"]',
    );
    expect(reviewRow?.textContent).toContain("Weekly analytics dashboard");
    expect(reviewRow?.textContent).not.toContain(
      "Design a compact analytics view",
    );
    expect(reviewRow?.textContent).not.toContain("Keep the chart inline.");

    await act(async () => reviewRow?.click());

    const detail = await vi.waitFor(() => {
      const current = reviewDetail("run-1");
      expect(current).toBeTruthy();
      return current!;
    });
    expect(reviewRow?.getAttribute("aria-expanded")).toBe("true");
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(
        detail.querySelector("[data-review-preview] iframe"),
      ).not.toBeNull();
    });
    expect(
      detail.querySelector("[data-review-transcript]")?.textContent,
    ).toContain("Keep the chart inline.");
    const threadLink = detail.querySelector<HTMLAnchorElement>("a[href]");
    expect(threadLink?.textContent).toContain("Open task thread");
    const threadUrl = new URL(threadLink!.href);
    expect(threadUrl.searchParams.get("thread")).toBe("thread-1");
    expect(threadUrl.searchParams.get("agentSidebar")).toBe("open");
    const summarizeButton = Array.from(
      detail.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Summarize with agent"));
    expect(summarizeButton).toBeTruthy();
    await act(async () => summarizeButton?.click());
    expect(mockSendToAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        submit: true,
        openSidebar: true,
        usageLabel: "observability:human-review-summary",
        message: expect.stringContaining('"run-1"'),
      }),
    );
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(
      detail
        .querySelector('[aria-label="Thumbs down"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      detail
        .querySelector('[aria-label="Thumbs up"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    await act(async () =>
      detail.querySelector('[aria-label="Thumbs up"]')?.click(),
    );
    expect(mockSubmitFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", feedbackType: "thumbs_up" }),
      expect.any(Object),
    );

    await act(async () =>
      detail
        .querySelector<HTMLButtonElement>("[data-review-lightbox-trigger]")
        ?.click(),
    );
    const lightbox = await vi.waitFor(() => {
      const current = lightboxDialog();
      expect(current).toBeTruthy();
      return current!;
    });
    expect(lightbox.querySelector('[aria-label="Thumbs up"]')).toBeNull();
    await act(async () => closeLightboxButton(lightbox)?.click());
    await vi.waitFor(() => expect(lightboxDialog()).toBeNull());
    expect(reviewDetail("run-1")).not.toBeNull();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-review-run-id="run-2"]')
        ?.click(),
    );
    expect(reviewDetail("run-1")).toBeNull();
    expect(reviewDetail("run-2")).not.toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>('[data-review-run-id="run-2"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("shows a saved summary and links only its local artifact path", async () => {
    mockOutputReviews.mockReturnValue({
      isLoading: false,
      data: [
        {
          runId: "run-summary",
          threadId: "thread-summary",
          ask: "Legacy raw ask",
          answer: "Legacy raw outcome",
          threadTitle: "Thread title before summary",
          summary: {
            ask: "Compare the campaign charts",
            outcome: "The updated analytics dashboard shows a clear lift.",
            artifacts: [
              {
                appId: "analytics",
                artifactId: "dashboard-1",
                title: "Campaign dashboard",
                path: "/dashboards/dashboard-1",
              },
              {
                appId: "design",
                artifactId: "design-2",
                title: "Campaign design",
                path: "/present/design-2",
              },
              {
                appId: "design",
                artifactId: "design-evil",
                title: "Untrusted external path",
                path: "https://example.com/design-evil",
              },
            ],
          },
          hasInlineApp: false,
          model: "test-model",
          createdAt: Date.now(),
          feedback: [],
          instructionUpdate: null,
        },
      ],
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider persistPreference={false}>
            <ObservabilityDashboard showHumanReview />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });

    const reviewTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Human review"),
    );
    await act(async () => reviewTab?.click());

    const row = container.querySelector<HTMLButtonElement>(
      '[data-review-run-id="run-summary"]',
    );
    expect(row?.textContent).toContain("Compare the campaign charts");
    expect(row?.textContent).not.toContain("Thread title before summary");
    expect(
      container.querySelector(
        `[data-preview-kind="design-iframe-thumbnail"] iframe[src="${window.location.origin}/present/design-2?reviewEmbed=1"]`,
      ),
    ).not.toBeNull();
    await act(async () => row?.click());

    const detail = await vi.waitFor(() => {
      const current = reviewDetail("run-summary");
      expect(current).toBeTruthy();
      return current!;
    });
    expect(
      detail.querySelector("[data-review-summary]")?.textContent,
    ).toContain("The updated analytics dashboard shows a clear lift.");
    const artifactLink = detail.querySelector<HTMLAnchorElement>(
      'a[href="http://localhost:8088/dashboards/dashboard-1"]',
    );
    expect(artifactLink?.textContent).toContain("Campaign dashboard");
    expect(
      detail.querySelector('a[href="https://example.com/design-evil"]'),
    ).toBeNull();
    expect(
      Array.from(detail.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Summarize with agent"),
      ),
    ).toBe(false);
  });

  it("keeps notes scoped to their review and allows instruction drafts", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider persistPreference={false}>
            <ObservabilityDashboard showHumanReview />
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

    let detail = await vi.waitFor(() => {
      const current = reviewDetail("run-1");
      expect(current).toBeTruthy();
      return current!;
    });
    await act(async () =>
      detail.querySelector('[aria-label="Add feedback"]')?.click(),
    );
    const feedbackInput = await vi.waitFor(() => {
      const input = popoverTextarea("What should change or stay the same?");
      expect(input).toBeTruthy();
      return input!;
    });
    expect(feedbackInput).toBeTruthy();
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
      container
        .querySelector<HTMLButtonElement>('[data-review-run-id="run-2"]')
        ?.click(),
    );

    detail = await vi.waitFor(() => {
      const current = reviewDetail("run-2");
      expect(current).toBeTruthy();
      return current!;
    });
    await act(async () =>
      detail.querySelector('[aria-label="Add feedback"]')?.click(),
    );
    const secondFeedbackInput = await vi.waitFor(() => {
      const input = popoverTextarea("What should change or stay the same?");
      expect(input).toBeTruthy();
      return input!;
    });
    expect(secondFeedbackInput?.value).toBe("");
    await act(async () =>
      detail.querySelector('[aria-label="Add feedback"]')?.click(),
    );
    await vi.waitFor(() =>
      expect(
        popoverTextarea("What should change or stay the same?"),
      ).toBeUndefined(),
    );

    const secondRow = container.querySelector<HTMLButtonElement>(
      '[data-review-run-id="run-2"]',
    );
    await act(async () => secondRow?.click());
    await vi.waitFor(() => expect(reviewDetail("run-2")).toBeNull());
    await act(async () => secondRow?.click());
    detail = await vi.waitFor(() => {
      const current = reviewDetail("run-2");
      expect(current).toBeTruthy();
      return current!;
    });

    const draftButton = detail.querySelector<HTMLButtonElement>(
      '[aria-label="Draft instruction"]',
    );
    expect(draftButton).toBeTruthy();
    await act(async () => draftButton?.click());
    const instructionInput = await vi.waitFor(() => {
      const input = popoverTextarea(
        "Write the instruction change for a human to review.",
      );
      expect(input).toBeTruthy();
      return input!;
    });
    expect(instructionInput).toBeTruthy();
    await act(async () => {
      if (!instructionInput) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(instructionInput, "Keep the slide title concise");
      instructionInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = popoverButton(instructionInput, "Save draft update");
    await act(async () => saveButton?.click());
    expect(mockSaveInstructionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-2",
        threadId: "thread-2",
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
            <ObservabilityDashboard showHumanReview />
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    const reviewTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Human review"),
    );
    await act(async () => reviewTab?.click());

    const openRun = async (runId: string) => {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(`[data-review-run-id="${runId}"]`)
          ?.click();
      });
      await vi.waitFor(() => expect(reviewDetail(runId)).toBeTruthy());
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
      reviewDetail("run-1")
        ?.querySelector<HTMLButtonElement>('[aria-label="Add feedback"]')
        ?.click(),
    );
    let input = popoverTextarea("What should change or stay the same?");
    expect(input).toBeTruthy();
    await setText(input!, "Feedback for A");
    await act(async () => popoverButton(input!, "Save feedback")?.click());

    await openRun("run-2");
    await act(async () =>
      reviewDetail("run-2")
        ?.querySelector<HTMLButtonElement>('[aria-label="Add feedback"]')
        ?.click(),
    );
    input = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="What should change or stay the same?"]',
    );
    expect(input).toBeTruthy();
    await setText(input!, "Feedback for B");
    await act(async () => finishFeedbackA?.());
    expect(input?.value).toBe("Feedback for B");

    await openRun("run-1");
    await act(async () =>
      reviewDetail("run-1")
        ?.querySelector<HTMLButtonElement>('[aria-label="Draft instruction"]')
        ?.click(),
    );
    input = popoverTextarea(
      "Write the instruction change for a human to review.",
    );
    expect(input).toBeTruthy();
    await setText(input!, "Instruction for A");
    await act(async () => popoverButton(input!, "Save draft update")?.click());

    await openRun("run-2");
    await act(async () =>
      reviewDetail("run-2")
        ?.querySelector<HTMLButtonElement>('[aria-label="Draft instruction"]')
        ?.click(),
    );
    input = popoverTextarea(
      "Write the instruction change for a human to review.",
    );
    expect(input).toBeTruthy();
    await setText(input!, "Instruction for B");
    await act(async () => finishInstructionA?.());
    expect(input?.value).toBe("Instruction for B");
  });
});

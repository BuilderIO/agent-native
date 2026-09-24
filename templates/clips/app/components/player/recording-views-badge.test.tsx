// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalyticsHandoff } from "./connect-analytics-dialog";
import {
  AgentViewerAvatar,
  RecordingViewsBadge,
  ViewerAvatar,
} from "./recording-views-badge";

const queryMocks = vi.hoisted(() => ({
  calls: [] as string[],
  avatarEmails: [] as Array<string | null | undefined>,
  avatarUrl: null as string | null,
}));

const handoffMocks = vi.hoisted(() => ({
  sendToAgentChat: vi.fn(() => "analytics-tab"),
  trackEvent: vi.fn(),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: handoffMocks.sendToAgentChat,
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: handoffMocks.trackEvent,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    _params: unknown,
    options?: { enabled?: boolean },
  ) => {
    if (options?.enabled !== false) queryMocks.calls.push(name);
    return { data: undefined, isLoading: false };
  },
  useAvatarUrl: (email: string | null | undefined) => {
    queryMocks.avatarEmails.push(email);
    return queryMocks.avatarUrl;
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
  AvatarFallback: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/agent-destination-logos", () => ({
  ClaudeLogo: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-agent-logo="claude" {...props} />
  ),
  CodexLogo: (props: React.HTMLAttributes<HTMLSpanElement>) => (
    <span data-agent-logo="codex" {...props} />
  ),
}));

describe("RecordingViewsBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryMocks.calls = [];
    queryMocks.avatarEmails = [];
    queryMocks.avatarUrl = null;
    handoffMocks.sendToAgentChat.mockClear();
    handoffMocks.trackEvent.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(node: React.ReactElement) {
    act(() => root.render(node));
  }

  it("renders nothing for a visitor when there are no views", () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        viewCount={0}
        canViewDetails={false}
      />,
    );

    expect(container.textContent).toBe("");
    expect(queryMocks.calls).toEqual([]);
  });

  it("still renders a zero count for an owner", () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        viewCount={0}
        canViewDetails
      />,
    );

    expect(container.querySelector("button")).not.toBeNull();
  });

  it("renders plain non-interactive text for a visitor and fires no queries", () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        viewCount={11}
        canViewDetails={false}
      />,
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.textContent).toContain("recordingInsights.viewsCount");
    expect(container.textContent).toContain("11");
    expect(queryMocks.calls).toEqual([]);
  });

  it("renders a human-view trigger that opens attached viewer details", () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        viewCount={12}
        canViewDetails
      />,
    );

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("recordingInsights.viewsCount");
    expect(queryMocks.calls).toEqual(["list-viewers"]);
  });

  it("shows human and agent views as one total badge count", () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        viewCount={2}
        agentViewCount={1}
        canViewDetails
      />,
    );

    expect(container.textContent).toContain("recordingInsights.viewsCount");
    expect(container.textContent).toContain("3");
    expect(
      container.querySelector('[aria-label*="agentViewsCount"]'),
    ).toBeNull();
    expect(
      container.querySelector("button")?.getAttribute("aria-label"),
    ).toContain("recordingInsights.viewsCount");
    expect(
      container.querySelector("button")?.getAttribute("aria-label"),
    ).not.toContain("recordingInsights.agentViewsCount");
  });

  it("shows the human and agent breakdown inside the Views tab", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/player/recording-views-badge.tsx"),
      "utf8",
    );
    const chartSource = readFileSync(
      resolve(process.cwd(), "app/components/player/insights-chart.tsx"),
      "utf8",
    );
    const agentViewCountSource = readFileSync(
      resolve(process.cwd(), "app/components/player/agent-view-count.tsx"),
      "utf8",
    );
    const controlsSource = readFileSync(
      resolve(process.cwd(), "app/components/player/viewer-controls.tsx"),
      "utf8",
    );

    expect(source).toContain("<Popover");
    expect(source).toContain("<Tabs");
    expect(source).toContain("<ViewerTabsList");
    expect(source).toContain("<ViewerTabsTrigger");
    expect(source).not.toContain("<TabsList");
    expect(source).not.toContain("<TabsTrigger");
    expect(source).toContain('value="views"');
    expect(source).toContain('value="insights"');
    expect(source).toContain("<LazyInsightsChart");
    expect(source).toContain('import("./insights-chart")');
    expect(source).toContain("onPointerEnter={preloadInsightsChart}");
    expect(source).toContain("onFocus={preloadInsightsChart}");
    expect(source).not.toContain('from "./insights-chart"');
    expect(chartSource).toContain("<ChartContainer");
    expect(chartSource).toContain("<RadialBarChart");
    expect(chartSource).toContain("<PolarAngleAxis");
    expect(chartSource).toContain("<PolarRadiusAxis");
    expect(chartSource).toContain("<RadialBar");
    expect(chartSource).toContain("<ChartTooltipContent");
    expect(chartSource).toContain("isAnimationActive={false}");
    expect(chartSource).toContain("animationDuration={600}");
    expect(chartSource).toContain('isAnimationActive="auto"');
    expect(chartSource).toContain('addEventListener("pointermove"');
    expect(chartSource).toContain("position={position}");
    expect(chartSource).toContain('dataKey="value"');
    expect(chartSource).toContain("domain={[0, 100]}");
    expect(chartSource).toContain('indicatorClassName="bg-highlight"');
    expect(chartSource).not.toContain("dropOff");
    expect(source).not.toContain("<ResponsiveContainer");
    expect(controlsSource).toContain(
      "overflow-x-auto overflow-y-hidden rounded-none",
    );
    expect(source).toContain('<ViewerTabsList className="overflow-visible">');
    expect(source).not.toContain("onOpenInsights");
    expect(source).toContain("<ViewerSection");
    expect(source).toContain("agentViewCount");
    expect(source).not.toContain("<AgentViewCount");
    expect(agentViewCountSource).toContain("<ClaudeLogo");
    expect(agentViewCountSource).toContain("<CodexLogo");
  });

  it("loads the Insights chart only after opening its tab", async () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        viewCount={12}
        canViewDetails
      />,
    );

    act(() => container.querySelector("button")?.click());
    const insightTab = Array.from(
      document.body.querySelectorAll('[role="tab"]'),
    ).find((tab) => tab.textContent === "recordingInsights.insightsTab");

    expect(insightTab).not.toBeUndefined();
    expect(document.body.querySelector("dd")).toBeNull();

    await act(async () => {
      (insightTab as HTMLElement).focus();
      for (
        let attempt = 0;
        attempt < 100 && !document.body.querySelector("dd");
        attempt++
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(insightTab?.getAttribute("aria-selected")).toBe("true");
    expect(document.body.querySelector("dd")).not.toBeNull();
  });

  it("keeps library cards on the lightweight agent-view module", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/library/recording-card.tsx"),
      "utf8",
    );

    expect(source).toContain('from "@/components/player/agent-view-count"');
    expect(source).not.toContain(
      'from "@/components/player/recording-views-badge"',
    );
  });

  it("parks the Analytics handoff outside the visible insights experience", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/player/recording-views-badge.tsx"),
      "utf8",
    );

    expect(source).not.toContain("<ConnectAnalyticsDialog");
    expect(source).not.toContain("recordingInsights.connectAnalytics");
  });

  it("uses one-click Item actions for the Analytics destination", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/components/player/connect-analytics-dialog.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("<ItemGroup");
    expect(source).toContain("<ItemSeparator");
    expect(source).toContain("<ItemActions");
    expect(source).toContain('onClick={() => handoff("analysis")}');
    expect(source).toContain('onClick={() => handoff("dashboard")}');
    expect(source).not.toContain("<RadioGroup");
    expect(source).not.toContain("<RadioGroupItem");
    expect(source).not.toContain("<DialogFooter");
    expect(source).not.toContain("<ItemDescription");
    expect(source).not.toContain("sm:w-48");
    expect(source).not.toContain("MetricPreview");
    expect(source).not.toContain("analyticsIncludes");
  });

  it("keeps the Analytics handoff scoped to a recording snapshot", () => {
    const handoff = buildAnalyticsHandoff({
      destination: "dashboard",
      recordingId: "recording-1",
      recordingTitle: "Launch walkthrough",
      views: 12,
      uniqueViewers: 9,
      completionRate: 75,
      reactions: 3,
      ctaConversionRate: 25,
      hasDropOff: true,
    });

    expect(handoff.message).toContain("new or existing Agent-Native Analytics");
    expect(handoff.message).toContain("dashboard");
    expect(JSON.parse(handoff.context)).toMatchObject({
      sourceApp: "clips",
      sourceSurface: "recording_insights",
      recordingId: "recording-1",
      destination: "dashboard",
      snapshot: {
        views: 12,
        uniqueViewers: 9,
        completionRate: 75,
        reactions: 3,
        ctaConversionRate: 25,
        hasDropOff: true,
      },
    });
    expect(JSON.parse(handoff.context).instructions).toContain(
      "choose an existing dashboard or create a new private dashboard",
    );
  });

  it("renders no completion percentage when there is no human playback sample", async () => {
    const { InsightsChart } = await import("./insights-chart");
    render(
      <InsightsChart
        views={8}
        uniqueViewers={0}
        reactions={0}
        completionRate={null}
        ctaConversionRate={null}
      />,
    );

    const rates = Array.from(container.querySelectorAll("dd")).map(
      (node) => node.textContent,
    );
    expect(rates).toContain("—");
    expect(rates).not.toContain("0%");
  });

  it("still renders a real zero completion percentage", async () => {
    const { InsightsChart } = await import("./insights-chart");
    render(
      <InsightsChart
        views={3}
        uniqueViewers={3}
        reactions={0}
        completionRate={0}
        ctaConversionRate={0}
      />,
    );

    const rates = Array.from(container.querySelectorAll("dd")).map(
      (node) => node.textContent,
    );
    expect(rates).toContain("0%");
  });

  it("resolves the stored profile image for an identified viewer", () => {
    queryMocks.avatarUrl = "data:image/jpeg;base64,avatar";

    render(
      <ViewerAvatar
        viewer={{
          viewerEmail: "viewer@example.com",
          viewerName: "Viewer Name",
        }}
      />,
    );

    expect(queryMocks.avatarEmails).toEqual(["viewer@example.com"]);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(queryMocks.avatarUrl);
    expect(image?.getAttribute("alt")).toBe("Viewer Name");
  });

  it("uses provider logos for identified agent viewers", () => {
    render(<AgentViewerAvatar agentLabel="Claude" />);

    expect(
      container.querySelector('[data-agent-logo="claude"]'),
    ).not.toBeNull();

    render(<AgentViewerAvatar agentLabel="ChatGPT" />);

    expect(container.querySelector('[data-agent-logo="codex"]')).not.toBeNull();
  });
});

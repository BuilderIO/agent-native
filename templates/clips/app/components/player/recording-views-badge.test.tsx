// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalyticsHandoff } from "./connect-analytics-dialog";
import { RecordingViewsBadge, ViewerAvatar } from "./recording-views-badge";

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

  it("splits viewers and insights into tabs without splitting human and agent lists", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/player/recording-views-badge.tsx"),
      "utf8",
    );
    const chartSource = readFileSync(
      resolve(process.cwd(), "app/components/player/insights-chart.tsx"),
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
    expect(source).toContain("<InsightsChart");
    expect(chartSource).toContain("<ChartContainer");
    expect(chartSource).toContain("<RadialBarChart");
    expect(chartSource).toContain("<PolarAngleAxis");
    expect(chartSource).toContain("<PolarRadiusAxis");
    expect(chartSource).toContain("<RadialBar");
    expect(chartSource).toContain("<ChartTooltipContent");
    expect(chartSource).toContain('dataKey="value"');
    expect(chartSource).toContain("domain={[0, 100]}");
    expect(chartSource).toContain('indicatorClassName="bg-highlight"');
    expect(chartSource).not.toContain("dropOff");
    expect(source).not.toContain("<ResponsiveContainer");
    expect(source).not.toContain("onOpenInsights");
    expect(source).not.toContain('t("recordingInsights.humanViews")');
    expect(source).not.toContain("agentViewCount");
    expect(source).not.toContain('t("recordingInsights.agentViews")');
  });

  it("offers an Analytics handoff from the insights tab", () => {
    render(
      <RecordingViewsBadge
        recordingId="recording-1"
        recordingTitle="Launch walkthrough"
        viewCount={12}
        reactionCount={3}
        defaultOpen
        canViewDetails
      />,
    );

    const connectButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("recordingInsights.connectAnalytics"),
    );
    expect(connectButton).not.toBeUndefined();

    act(() => connectButton?.click());
    const openButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("recordingInsights.startChatAction"),
    );
    expect(openButton).not.toBeUndefined();

    act(() => openButton?.click());
    expect(handoffMocks.sendToAgentChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Launch walkthrough"),
        newTab: true,
        usageLabel: "clips:analytics-analysis",
      }),
    );
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
});

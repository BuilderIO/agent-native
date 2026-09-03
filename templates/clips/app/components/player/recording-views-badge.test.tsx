// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingViewsBadge, ViewerAvatar } from "./recording-views-badge";

const queryMocks = vi.hoisted(() => ({
  calls: [] as string[],
  avatarEmails: [] as Array<string | null | undefined>,
  avatarUrl: null as string | null,
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

    expect(source).toContain("<Popover");
    expect(source).toContain("<Tabs");
    expect(source).toContain("<ViewerTabsList");
    expect(source).toContain("<ViewerTabsTrigger");
    expect(source).not.toContain("<TabsList");
    expect(source).not.toContain("<TabsTrigger");
    expect(source).toContain('value="views"');
    expect(source).toContain('value="insights"');
    expect(source).not.toContain("onOpenInsights");
    expect(source).not.toContain('t("recordingInsights.humanViews")');
    expect(source).not.toContain("agentViewCount");
    expect(source).not.toContain('t("recordingInsights.agentViews")');
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

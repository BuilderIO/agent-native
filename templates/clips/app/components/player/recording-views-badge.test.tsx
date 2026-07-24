// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecordingViewsBadge } from "./recording-views-badge";

const queryMocks = vi.hoisted(() => ({
  calls: [] as string[],
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
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

describe("RecordingViewsBadge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryMocks.calls = [];
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

  it("renders a popover trigger button and loads viewers when details are allowed", () => {
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
});

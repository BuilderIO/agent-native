// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BrowserDiagnosticsPanel,
  buildBrowserDiagnosticGroups,
  formatDiagnosticTime,
  isFullBrowserDiagnostics,
} from "./browser-diagnostics-panel";
import {
  VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
  VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS,
} from "./browser-diagnostics.fixture";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, string | number>) => {
    const messages: Record<string, string> = {
      "browserDiagnostics.afterRecording": "After recording",
      "browserDiagnostics.browserCapture": "Browser capture",
      "browserDiagnostics.captureSuccessful": "Capture successful",
      "browserDiagnostics.capturedDescription":
        "Diagnostics were captured for this recording.",
      "browserDiagnostics.capturedFrom": "Captured from {{source}}",
      "browserDiagnostics.consoleCount": "Console {{count}}",
      "browserDiagnostics.consoleSource": "Console",
      "browserDiagnostics.duration": "Duration",
      "browserDiagnostics.error": "Error",
      "browserDiagnostics.failuresPresent": "Failures present",
      "browserDiagnostics.failureSummary":
        "{{consoleCount}} console issues · {{networkCount}} failed requests",
      "browserDiagnostics.issues": "Issues",
      "browserDiagnostics.message": "Message",
      "browserDiagnostics.networkCount": "Network {{count}}",
      "browserDiagnostics.networkSource": "Network",
      "browserDiagnostics.noConsoleTitle": "No console events",
      "browserDiagnostics.noFailures": "No failures detected",
      "browserDiagnostics.noIssuesTitle": "No browser issues detected",
      "browserDiagnostics.noNetworkTitle": "No network requests",
      "browserDiagnostics.occurrences": "Occurrences",
      "browserDiagnostics.request": "Request",
      "browserDiagnostics.seekToTime": "Seek to {{time}}",
      "browserDiagnostics.stackTrace": "Stack trace",
      "browserDiagnostics.status": "Status",
      "browserDiagnostics.title": "Browser diagnostics",
      "browserDiagnostics.views": "Diagnostic views",
    };
    return Object.entries(values ?? {}).reduce(
      (message, [name, value]) => message.replace(`{{${name}}}`, String(value)),
      messages[key] ?? key,
    );
  },
}));

describe("browser diagnostics data", () => {
  it("adapts the public fixture to the internal relative-time contract", () => {
    expect(isFullBrowserDiagnostics(VIEWER_PREVIEW_BROWSER_DIAGNOSTICS)).toBe(
      true,
    );
    expect(VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.consoleLogs[14].elapsedMs).toBe(
      1483,
    );
    expect(
      VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.consoleLogs[14].timestampMs,
    ).toBeGreaterThan(1_000_000_000_000);
  });

  it("does not mistake a summary-only payload for inspectable diagnostics", () => {
    expect(
      isFullBrowserDiagnostics({
        summary: VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.summary,
      }),
    ).toBe(false);
  });

  it("groups exact duplicates only within each diagnostic stream", () => {
    const groups = buildBrowserDiagnosticGroups(
      VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
      "issues",
    );
    const schemaMismatch = groups.find(
      (group) =>
        group.kind === "console" &&
        group.entries[0].message.includes("PREVIEW_RENDERER_SCHEMA_MISMATCH"),
    );
    const failedRequests = groups.filter((group) => group.kind === "network");

    expect(schemaMismatch?.entries.map((entry) => entry.elapsedMs)).toEqual([
      0, 8114,
    ]);
    expect(failedRequests).toHaveLength(2);
  });

  it("keeps legacy post-recording events in the full stream", () => {
    const groups = buildBrowserDiagnosticGroups(
      VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
      "network",
    );
    expect(
      groups.filter((group) =>
        group.entries.some(
          (entry) => entry.elapsedMs > VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS,
        ),
      ),
    ).toHaveLength(2);
  });

  it("formats clip-relative times without implying epoch timestamps", () => {
    expect(formatDiagnosticTime(0)).toBe("0:00");
    expect(formatDiagnosticTime(7764)).toBe("0:07.7");
    expect(formatDiagnosticTime(61_234)).toBe("1:01.2");
  });
});

describe("BrowserDiagnosticsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses one accordion hierarchy with dense single-line event rows", () => {
    const onSeek = vi.fn();
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={VIEWER_PREVIEW_BROWSER_DIAGNOSTICS}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={onSeek}
        />,
      );
    });

    const issuesSection = container.querySelector(
      '[data-browser-diagnostics-section="issues"]',
    );
    const networkSection = container.querySelector(
      '[data-browser-diagnostics-section="network"]',
    );
    const eventRows = issuesSection?.querySelectorAll(
      "[data-browser-diagnostic-row]",
    );
    const nestedItems = issuesSection?.querySelector(
      "[data-browser-diagnostics-items]",
    );

    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(issuesSection?.getAttribute("data-state")).toBe("open");
    expect(networkSection?.getAttribute("data-state")).toBe("closed");
    expect(eventRows?.length).toBeGreaterThan(0);
    expect(nestedItems?.classList.contains("ps-4")).toBe(true);
    expect(eventRows?.[0]?.querySelector(".truncate")).not.toBeNull();
    expect(container.querySelector("button button")).toBeNull();

    const networkTrigger = networkSection?.querySelector("button");
    act(() => networkTrigger?.click());

    expect(issuesSection?.getAttribute("data-state")).toBe("closed");
    expect(networkSection?.getAttribute("data-state")).toBe("open");
  });

  it("keeps seeking independent from nested disclosure state", () => {
    const onSeek = vi.fn();
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={VIEWER_PREVIEW_BROWSER_DIAGNOSTICS}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={onSeek}
        />,
      );
    });

    const networkSection = container.querySelector(
      '[data-browser-diagnostics-section="network"]',
    );
    act(() => networkSection?.querySelector("button")?.click());

    const firstRequest = Array.from(
      networkSection?.querySelectorAll<HTMLButtonElement>(
        "[data-browser-diagnostic-row]",
      ) ?? [],
    ).find((button) =>
      button.textContent?.includes("/_agent-native/agent-engine/status"),
    );
    act(() => firstRequest?.click());

    expect(networkSection?.textContent).toContain("After recording");
    expect(firstRequest?.getAttribute("data-state")).toBe("open");

    const seekButton = Array.from(
      networkSection?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "0:06.6");
    act(() => seekButton?.click());

    expect(onSeek).toHaveBeenCalledWith(6643);
    expect(firstRequest?.getAttribute("data-state")).toBe("open");
    expect(networkSection?.getAttribute("data-state")).toBe("open");
  });

  it("keeps contextual empty states inside their sections", () => {
    const emptyDiagnostics = {
      ...VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
      consoleLogs: [],
      networkRequests: [],
      summary: {
        ...VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.summary,
        consoleCount: 0,
        consoleErrorCount: 0,
        consoleWarnCount: 0,
        networkCount: 0,
        networkFailureCount: 0,
      },
    };
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={emptyDiagnostics}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("No browser issues detected");
    const consoleSection = container.querySelector(
      '[data-browser-diagnostics-section="console"]',
    );
    act(() => consoleSection?.querySelector("button")?.click());

    expect(consoleSection?.getAttribute("data-state")).toBe("open");
    expect(consoleSection?.textContent).toContain("No console events");
  });
});

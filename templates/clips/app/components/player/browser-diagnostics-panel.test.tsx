// @vitest-environment happy-dom

import type { AppActivityEvent } from "@shared/app-activity";
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
      "browserDiagnostics.appData": "Data",
      "browserDiagnostics.appEvent": "Event",
      "browserDiagnostics.appFailureSummary": "{{count}} app failures",
      "browserDiagnostics.appSource": "App activity",
      "browserDiagnostics.appUnavailable": "App activity could not be loaded.",
      "browserDiagnostics.beforeRecording": "Before recording",
      "browserDiagnostics.noAppTitle": "No app activity",
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
      "browserDiagnostics.timeline": "Timeline",
      "browserDiagnostics.navigation": "Navigation",
      "browserDiagnostics.click": "Click",
      "browserDiagnostics.input": "Input",
      "browserDiagnostics.scroll": "Scroll",
      "browserDiagnostics.requestStarted": "Request started",
      "browserDiagnostics.responseReceived": "Response received",
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

const appEvents: AppActivityEvent[] = [
  {
    timestampMs: 1,
    elapsedMs: -800,
    type: "action",
    name: "list-folders",
    ok: false,
    status: 403,
    errorCode: "forbidden_scope",
  },
  {
    timestampMs: 2,
    elapsedMs: 500,
    type: "action",
    name: "list-labels",
    ok: true,
  },
  {
    timestampMs: 3,
    elapsedMs: 900,
    type: "action",
    name: "list-labels",
    ok: true,
  },
  {
    timestampMs: 4,
    elapsedMs: 1_200,
    type: "state",
    name: "design-selection",
    data: { opacity: 0.97 },
  },
  {
    timestampMs: 5,
    elapsedMs: 1_300,
    type: "state",
    name: "design-selection",
    data: { opacity: 0.91 },
  },
];

const listedIssueCount =
  VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.summary.consoleErrorCount +
  VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.summary.consoleWarnCount +
  VIEWER_PREVIEW_BROWSER_DIAGNOSTICS.summary.networkFailureCount;

const diagnosticsWithAppActivity = {
  ...VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
  appActivity: {
    app: "mail",
    build: "dev",
    eventCount: appEvents.length,
    failureCount: 1,
    dropped: 0,
    coverage: [{ fromElapsedMs: -30_000, toElapsedMs: 9_000 }],
    failures: [],
  },
};

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

  it("puts app failures under issues and groups only identical app events", () => {
    const issues = buildBrowserDiagnosticGroups(
      VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
      "issues",
      appEvents,
    ).filter((group) => group.kind === "app");
    expect(issues.map((group) => group.entries[0].name)).toEqual([
      "list-folders",
    ]);

    const app = buildBrowserDiagnosticGroups(
      VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
      "app",
      appEvents,
    );
    expect(
      app.map((group) =>
        group.kind === "app"
          ? [group.entries[0].name, group.entries.length]
          : group.kind,
      ),
    ).toEqual([
      ["list-folders", 1],
      ["list-labels", 2],
      ["design-selection", 1],
      ["design-selection", 1],
    ]);
    expect(
      buildBrowserDiagnosticGroups(
        VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
        "console",
        appEvents,
      ).some((group) => group.kind === "app"),
    ).toBe(false);
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

  it("shows app activity as its own seekable section, marking lookback rows as before the recording", () => {
    const onSeek = vi.fn();
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={diagnosticsWithAppActivity}
          appActivityEvents={{ status: "ready", events: appEvents }}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={onSeek}
        />,
      );
    });

    expect(container.textContent).toContain("1 app failures");
    const appSection = container.querySelector(
      '[data-browser-diagnostics-section="app"]',
    );
    expect(appSection?.textContent).toContain("App activity");
    expect(appSection?.textContent).toContain(String(appEvents.length));
    act(() => appSection?.querySelector("button")?.click());

    expect(appSection?.textContent).toContain("Before recording");
    const seekButton = Array.from(
      appSection?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent === "0:01.2");
    act(() => seekButton?.click());
    expect(onSeek).toHaveBeenCalledWith(1_200);

    const issuesSection = container.querySelector(
      '[data-browser-diagnostics-section="issues"]',
    );
    expect(issuesSection?.querySelector("button")?.textContent).toBe(
      `Issues${listedIssueCount + 1}`,
    );
    act(() => issuesSection?.querySelector("button")?.click());
    expect(issuesSection?.textContent).toContain("list-folders");
  });

  it("keeps unreadable app activity distinct from an empty section", () => {
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={diagnosticsWithAppActivity}
          appActivityEvents={{ status: "failed" }}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={vi.fn()}
        />,
      );
    });
    const appSection = container.querySelector(
      '[data-browser-diagnostics-section="app"]',
    );
    act(() => appSection?.querySelector("button")?.click());

    expect(appSection?.textContent).toContain(
      "App activity could not be loaded.",
    );
    expect(appSection?.textContent).not.toContain("No app activity");
    expect(
      container
        .querySelector('[data-browser-diagnostics-section="issues"]')
        ?.querySelector("button")?.textContent,
    ).toBe(`Issues${listedIssueCount}`);
  });

  it("leaves out the app section when the recording has no app activity", () => {
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={VIEWER_PREVIEW_BROWSER_DIAGNOSTICS}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={vi.fn()}
        />,
      );
    });
    expect(
      container.querySelector('[data-browser-diagnostics-section="app"]'),
    ).toBeNull();
  });

  it("renders the structured timeline before the diagnostic streams", () => {
    const onSeek = vi.fn();
    const diagnostics = {
      ...VIEWER_PREVIEW_BROWSER_DIAGNOSTICS,
      timeline: [
        {
          timestampMs: 1_234,
          elapsedMs: 1_234,
          kind: "click" as const,
          target: "button#submit",
        },
        {
          timestampMs: 1_500,
          elapsedMs: 1_500,
          kind: "network" as const,
          phase: "response" as const,
          type: "fetch" as const,
          method: "POST",
          url: "/api/items",
          status: 500,
          durationMs: 120,
        },
      ],
    };
    act(() => {
      root.render(
        <BrowserDiagnosticsPanel
          diagnostics={diagnostics}
          durationMs={VIEWER_PREVIEW_DIAGNOSTICS_DURATION_MS}
          onSeek={onSeek}
        />,
      );
    });

    const timeline = container.querySelector(
      '[data-browser-diagnostics-section="timeline"]',
    );
    expect(timeline?.getAttribute("data-state")).toBe("open");
    expect(timeline?.textContent).toContain("Click");
    expect(timeline?.textContent).toContain("button#submit");
    expect(timeline?.textContent).toContain("500");
  });
});

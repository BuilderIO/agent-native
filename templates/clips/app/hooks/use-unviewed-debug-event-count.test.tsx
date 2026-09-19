// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUnviewedDebugEventCount } from "./use-unviewed-debug-event-count";

interface HarnessProps {
  recordingId: string | undefined;
  summary: { consoleErrorCount: number; networkFailureCount: number } | null;
  isDebugTabActive: boolean;
}

function Harness({ recordingId, summary, isDebugTabActive }: HarnessProps) {
  const count = useUnviewedDebugEventCount(
    recordingId,
    summary,
    isDebugTabActive,
  );
  return <span data-testid="count">{count}</span>;
}

describe("useUnviewedDebugEventCount", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderedCount(): string {
    return container.querySelector('[data-testid="count"]')?.textContent ?? "";
  }

  it("shows the correct unviewed count for events never viewed", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={false}
        />,
      );
    });

    expect(renderedCount()).toBe("3");
  });

  it("is hidden (renders 0) when there are no surfaced debug events", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 0, networkFailureCount: 0 }}
          isDebugTabActive={false}
        />,
      );
    });

    expect(renderedCount()).toBe("0");
  });

  it("clears to 0 once the Debug tab becomes active", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={false}
        />,
      );
    });
    expect(renderedCount()).toBe("3");

    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={true}
        />,
      );
    });

    expect(renderedCount()).toBe("0");
  });

  it("stays cleared after leaving the Debug tab (viewed state persists)", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={true}
        />,
      );
    });
    expect(renderedCount()).toBe("0");

    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={false}
        />,
      );
    });

    expect(renderedCount()).toBe("0");
  });

  it("shows only the count of new events that arrived while on another tab", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={true}
        />,
      );
    });
    expect(renderedCount()).toBe("0");

    // New failures arrive while the viewer is on a different tab.
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 4, networkFailureCount: 2 }}
          isDebugTabActive={false}
        />,
      );
    });

    expect(renderedCount()).toBe("3");
  });

  it("re-viewing the Debug tab clears the badge again after new events arrived", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 1 }}
          isDebugTabActive={true}
        />,
      );
    });
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 4, networkFailureCount: 2 }}
          isDebugTabActive={false}
        />,
      );
    });
    expect(renderedCount()).toBe("3");

    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 4, networkFailureCount: 2 }}
          isDebugTabActive={true}
        />,
      );
    });

    expect(renderedCount()).toBe("0");
  });

  it("tracks viewed state independently per recording", () => {
    act(() => {
      root.render(
        <Harness
          recordingId="rec-1"
          summary={{ consoleErrorCount: 2, networkFailureCount: 0 }}
          isDebugTabActive={true}
        />,
      );
    });
    expect(renderedCount()).toBe("0");

    act(() => {
      root.render(
        <Harness
          recordingId="rec-2"
          summary={{ consoleErrorCount: 5, networkFailureCount: 0 }}
          isDebugTabActive={false}
        />,
      );
    });

    expect(renderedCount()).toBe("5");
  });
});

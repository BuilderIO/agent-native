// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import type { RecordingContextItem } from "./recording-context-model";
import {
  RecordingContextPanel,
  RecordingContextSection,
} from "./recording-context-panel";

const queryState = vi.hoisted(() => ({
  current: {
    isSuccess: false,
    isError: false,
    isPending: true,
    data: undefined as { items: unknown[] } | undefined,
    error: null as unknown,
  },
}));

const labState = vi.hoisted(() => ({ enabled: true }));
const queryOptions = vi.hoisted(() => ({
  current: undefined as { enabled?: boolean } | undefined,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    _action: string,
    _input: unknown,
    options?: { enabled?: boolean },
  ) => {
    queryOptions.current = options;
    return queryState.current;
  },
}));

vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({ enabled: labState.enabled }),
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  captureClientException: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

// Resolves keys against the real English catalog so copy changes show up here.
vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, values?: Record<string, string | number | undefined>) => {
      const found = key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          messages,
        );
      if (typeof found !== "string") throw new Error(`Missing copy: ${key}`);
      return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? ""),
      );
    },
}));

function item(overrides: Partial<RecordingContextItem>): RecordingContextItem {
  return {
    id: "ctx_1",
    recordingId: "rec_1",
    kind: "screen_history",
    label: null,
    requestedSeconds: 30,
    originalStartedAt: "2026-10-09T10:04:30.000Z",
    originalEndedAt: "2026-10-09T10:05:00.000Z",
    startedAt: "2026-10-09T10:04:30.000Z",
    endedAt: "2026-10-09T10:05:00.000Z",
    status: "ready",
    mediaRecordingId: "media_1",
    durationMs: 30000,
    width: 1280,
    height: 720,
    error: null,
    createdAt: "2026-10-09T10:05:01.000Z",
    updatedAt: "2026-10-09T10:05:30.000Z",
    ...overrides,
  };
}

function setQuery(next: Partial<typeof queryState.current>) {
  queryState.current = {
    isSuccess: false,
    isError: false,
    isPending: true,
    data: undefined,
    error: null,
    ...next,
  };
}

describe("RecordingContextPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => root.render(<RecordingContextPanel recordingId="rec_1" />));
  }

  it("shows a skeleton while the list loads, not a generic loading label", () => {
    setQuery({ isPending: true });
    render();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("video")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("says it is saving while an item is pending or processing", () => {
    setQuery({
      isSuccess: true,
      isPending: false,
      data: { items: [item({ status: "pending", mediaRecordingId: null })] },
    });
    render();
    expect(container.textContent).toContain("Saving earlier screen time…");
    expect(container.querySelector("video")).toBeNull();
  });

  it("shows the stored error text for a failed item", () => {
    setQuery({
      isSuccess: true,
      isPending: false,
      data: {
        items: [
          item({
            status: "failed",
            mediaRecordingId: null,
            error: "Export failed: disk full",
          }),
        ],
      },
    });
    render();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Export failed: disk full");
  });

  it("plays a ready item inline from the media recording and offers a larger view", () => {
    setQuery({
      isSuccess: true,
      isPending: false,
      data: { items: [item({})] },
    });
    render();

    expect(container.textContent).toContain("Screen before recording");
    expect(container.textContent).toContain("0:00–0:30 before recording");
    expect(container.textContent).toContain(
      "Edit the window in Clips Desktop.",
    );

    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe("/api/video/media_1");
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("controls")).toBe(true);

    const larger = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Larger",
    );
    expect(larger).toBeDefined();
    act(() => larger?.click());

    const dialogVideos = document.querySelectorAll('[role="dialog"] video');
    expect(dialogVideos.length).toBe(1);
    expect(dialogVideos[0]?.getAttribute("src")).toBe("/api/video/media_1");
  });
});

// The Transcript tab renders this section above the transcript; it owns the
// lab and item gate, so these cases pin what the tab shows.
describe("RecordingContextSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    labState.enabled = true;
    queryOptions.current = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(recordingId: string | undefined = "rec_1") {
    act(() =>
      root.render(<RecordingContextSection recordingId={recordingId} />),
    );
  }

  it("renders the panel when the lab is on and the clip has items", () => {
    setQuery({
      isSuccess: true,
      isPending: false,
      data: { items: [item({})] },
    });
    render();
    expect(container.textContent).toContain("Screen before recording");
    expect(container.textContent).toContain(
      "Edit the window in Clips Desktop.",
    );
    expect(container.querySelector("video")?.getAttribute("src")).toBe(
      "/api/video/media_1",
    );
  });

  it("renders nothing and does not query when the lab is off, even with items", () => {
    labState.enabled = false;
    setQuery({
      isSuccess: true,
      isPending: false,
      data: { items: [item({})] },
    });
    render();
    expect(container.innerHTML).toBe("");
    expect(queryOptions.current?.enabled).toBe(false);
  });

  it("renders nothing when the lab is on but the clip has no context items", () => {
    setQuery({
      isSuccess: true,
      isPending: false,
      data: { items: [] },
    });
    render();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for the viewer preview, which has no recording id", () => {
    setQuery({
      isSuccess: true,
      isPending: false,
      data: { items: [item({})] },
    });
    // Inline, not render(): the helper's default id would replace undefined.
    act(() => root.render(<RecordingContextSection recordingId={undefined} />));
    expect(container.innerHTML).toBe("");
  });
});

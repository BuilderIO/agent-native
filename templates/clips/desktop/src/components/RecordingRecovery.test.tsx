// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { desktopRecoveryCopy as copy } from "../i18n/en-US";
import type { PendingDesktopUpload } from "../lib/recording-recovery";
import { useRecordingRecoveryNavigation } from "../lib/recording-recovery-navigation";
import {
  RecordingRecovery,
  RecordingRecoveryPage,
  type RecordingRecoveryProps,
} from "./RecordingRecovery";

const native: PendingDesktopUpload = {
  kind: "native",
  recordingId: "native-clip",
  serverUrl: "https://example.test",
  folderPath: "/fake/drafts",
  durationMs: 1000,
  bytes: 10,
  hasAudio: true,
  hasCamera: false,
  savedAt: "2026-09-18T12:00:00Z",
  retryCount: 0,
  lastError: "Upload disconnected",
};
const browser: PendingDesktopUpload = {
  kind: "browser",
  recordingId: "browser-clip",
  serverUrl: "https://example.test",
  durationMs: 1000,
  bytes: 10,
  hasAudio: true,
  hasCamera: false,
  savedAt: "2026-09-18T11:00:00Z",
  retryCount: 0,
  chunkCount: 1,
  mimeType: "video/webm",
};

describe("RecordingRecovery", () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: RecordingRecoveryProps;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    props = {
      uploads: [native, browser],
      lookupErrors: [],
      actionErrors: {},
      refreshing: false,
      retryingUploadId: null,
      retryingUploadStatus: null,
      exportingUploadId: null,
      authenticated: true,
      finalizing: false,
      needsStorage: (message) => !!message?.includes("storage"),
      onRefresh: vi.fn(),
      onRetry: vi.fn(),
      onCancelRetry: vi.fn(),
      onExport: vi.fn(),
      onOpenFolder: vi.fn(),
      onConnectStorage: vi.fn(),
      onReviewFiles: vi.fn(),
      onOpenLogs: vi.fn(),
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const buttons = (label: string) =>
    Array.from(host.querySelectorAll("button")).filter(
      (button) =>
        button.getAttribute("aria-label") === label ||
        button.textContent?.trim() === label,
    );
  const renderPage = (onBack = vi.fn()) =>
    act(() =>
      root.render(<RecordingRecoveryPage {...props} onBack={onBack} />),
    );
  const openMore = (index = 0) =>
    act(() =>
      buttons(copy.moreOptions)[index].dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      ),
    );
  const selectMenu = (label: string) =>
    act(() => {
      const item = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.trim() === label);
      expect(item).toBeDefined();
      item!.click();
    });
  const openDiagnostic = async (index = 0) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() => {
      host
        .querySelectorAll<HTMLElement>('[data-slot="item-description"]')
        [index].focus();
    });
  };

  it("renders only one full-width navigation row, never inline actions or diagnostics", () => {
    props.actionErrors = {
      "native:native-clip": "ffmpeg: enormous technical error",
    };
    const onOpen = vi.fn();
    act(() => root.render(<RecordingRecovery {...props} onOpen={onOpen} />));
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.textContent).toBe("2 clips need attention");
    expect(
      host
        .querySelector("button")
        ?.classList.contains("recording-recovery-summary"),
    ).toBe(true);
    expect(host.querySelector("[aria-expanded]")).toBeNull();
    expect(host.textContent).not.toContain("ffmpeg");
    expect(host.querySelector('[data-slot="item"]')).toBeNull();
    act(() => host.querySelector("button")!.click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });

  it("uses a generic summary when orphan errors make an exact clip count unknown", () => {
    props.uploads = [native];
    props.actionErrors = { "failure:unknown": "No source bytes" };
    act(() => root.render(<RecordingRecovery {...props} onOpen={vi.fn()} />));
    expect(host.textContent).toBe(copy.recordingsNeedAttention);
    expect(host.textContent).not.toContain(copy.attentionOne);
  });

  it.each([
    ["retryable upload", { uploads: [native] }, "warning"],
    [
      "incomplete recording",
      { uploads: [{ ...native, kind: "native", corrupt: true }] },
      "error",
    ],
    [
      "mixed warning and error",
      { uploads: [native, { ...browser, lastError: "Save failed" }] },
      "error",
    ],
    [
      "orphan error",
      {
        uploads: [],
        actionErrors: {
          "failure:orphan": "Save failed",
          "native:orphan": "Folder unavailable",
        },
      },
      "error",
    ],
    [
      "lookup failure",
      {
        uploads: [],
        lookupErrors: [
          { kind: "native", cause: new Error("Read access denied") },
        ],
      },
      "warning",
    ],
    [
      "lookup error plus upload warning",
      {
        uploads: [native],
        lookupErrors: [
          { kind: "native", cause: new Error("Corrupt recovery metadata") },
        ],
      },
      "error",
    ],
    [
      "retry progress",
      {
        uploads: [{ ...native, lastError: "Save failed" }],
        retryingUploadId: "native:native-clip",
      },
      "neutral",
    ],
    [
      "export progress",
      { uploads: [browser], exportingUploadId: "browser:browser-clip" },
      "neutral",
    ],
    ["finalizing progress", { uploads: [], finalizing: true }, "neutral"],
  ] as const)("shares summary/list severity for %s", (_name, state, tone) => {
    Object.assign(props, state);
    act(() => root.render(<RecordingRecovery {...props} onOpen={vi.fn()} />));
    const icon = host.querySelector(".row-icon");
    expect(icon?.getAttribute("data-recovery-tone")).toBe(tone);
    expect(!!icon?.querySelector(".tabler-icon-alert-triangle")).toBe(
      tone !== "neutral",
    );
    renderPage();
    const listTones = Array.from(
      host.querySelectorAll('[data-slot="item-media"]'),
    ).map((item) => item.getAttribute("data-recovery-tone"));
    const highest = listTones.includes("error")
      ? "error"
      : listTones.includes("warning")
        ? "warning"
        : "neutral";
    expect(highest).toBe(tone);
  });

  it("keeps the error tile when a recoverable action error overlays a failed save on the same clip", () => {
    props.uploads = [{ ...native, lastError: "Save failed" }];
    props.actionErrors = { "native:native-clip": "Folder unavailable" };
    act(() => root.render(<RecordingRecovery {...props} onOpen={vi.fn()} />));
    expect(
      host.querySelector(".row-icon")?.getAttribute("data-recovery-tone"),
    ).toBe("error");
    renderPage();
    expect(
      host
        .querySelector('[data-slot="item-media"]')
        ?.getAttribute("data-recovery-tone"),
    ).toBe("error");
  });

  it("shows every clip and targets its own recovery actions on the separate page", () => {
    renderPage();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    for (const item of host.querySelectorAll('[data-slot="item"]')) {
      expect(
        item.querySelectorAll('[data-slot="item-description"]'),
      ).toHaveLength(1);
      expect(
        item.querySelector('[data-slot="item-title"]')?.textContent,
      ).not.toContain("Clip ·");
      expect(
        item.querySelector('[data-slot="item-title"]')?.getAttribute("title"),
      ).toBeTruthy();
    }
    expect(host.textContent).not.toContain(copy.localFilesAvailable);
    expect(buttons(copy.openFolder)).toHaveLength(0);
    expect(buttons(copy.export)).toHaveLength(0);
    for (const row of host.querySelectorAll('[role="listitem"]')) {
      expect(row.querySelectorAll("button")).toHaveLength(2);
    }
    act(() => buttons(copy.retry)[1].click());
    openMore(0);
    selectMenu(copy.openFolder);
    openMore(1);
    selectMenu(copy.export);
    expect(props.onRetry).toHaveBeenCalledWith(browser);
    expect(props.onOpenFolder).toHaveBeenCalledWith(native);
    expect(props.onExport).toHaveBeenCalledWith(browser);
    expect(host.textContent).not.toContain("safe");
  });

  it("explains signed-out retry for each clip while preserving local recovery and diagnostics", async () => {
    props.authenticated = false;
    renderPage();
    expect(buttons(copy.retry).every((button) => button.disabled)).toBe(true);
    openMore(0);
    selectMenu(copy.openFolder);
    expect(props.onOpenFolder).toHaveBeenCalledWith(native);
    openMore(1);
    selectMenu(copy.export);
    expect(props.onExport).toHaveBeenCalledWith(browser);
    expect(
      Array.from(host.querySelectorAll('[role="status"]')).map(
        (status) => status.textContent,
      ),
    ).toEqual([copy.signInToRetry, copy.signInToRetry]);
    await openDiagnostic();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      native.lastError,
    );
  });

  it("keeps incomplete status and no retry for a corrupt signed-out clip", () => {
    props.authenticated = false;
    props.uploads = [{ ...native, kind: "native", corrupt: true }];
    renderPage();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      copy.recordingIncomplete,
    );
    expect(buttons(copy.retry)).toHaveLength(0);
    openMore();
    selectMenu(copy.openFolder);
    expect(props.onOpenFolder).toHaveBeenCalledOnce();
  });

  it("keeps concise lookup failure with prior results and refresh action", () => {
    props.lookupErrors = [
      { kind: "native", cause: new Error("Long low-level stack trace") },
    ];
    renderPage();
    expect(host.textContent).toContain(copy.lookupFailed);
    expect(host.textContent).not.toContain("Long low-level");
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(3);
    act(() => buttons(copy.refresh)[0].click());
    expect(props.onRefresh).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "Rewind audio materialization requires ffmpeg",
      "audioNeedsFfmpeg",
      "warning",
    ],
    ["ffmpeg process failed", "recordingIncomplete", "error"],
    ["Upload disconnected", "uploadInterrupted", "warning"],
    ["No source bytes", "recordingIncomplete", "error"],
    ["Save failed", "localSaveFailed", "error"],
    ["Unrecognized failure", "recordingNeedsAttention", "warning"],
  ] as const)(
    "describes %s without inventing a cause",
    (lastError, copyKey, tone) => {
      props.uploads = [{ ...native, lastError }];
      renderPage();
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        copy[copyKey],
      );
      expect(
        host
          .querySelector('[data-slot="item-media"]')
          ?.getAttribute("data-recovery-tone"),
      ).toBe(tone);
      expect(
        host.querySelectorAll('[data-slot="item-actions"] button'),
      ).toHaveLength(2);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
    },
  );

  it("discloses the full diagnostic on keyboard focus without a Details action or extra button", async () => {
    const diagnostic =
      "ffmpeg failed while reading source bytes: " + "trace/".repeat(200);
    props.uploads = [{ ...native, lastError: diagnostic }];
    renderPage();
    expect(host.textContent).toContain(copy.recordingIncomplete);
    expect(document.body.textContent).not.toContain(diagnostic);
    await openDiagnostic();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      diagnostic,
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const description = host.querySelector('[role="status"]');
    expect(document.activeElement).toBe(description);
    expect(description?.getAttribute("aria-describedby")).toBe(
      document.querySelector('[role="tooltip"]')?.id,
    );
    openMore();
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).map(
        (item) => item.textContent,
      ),
    ).toEqual([copy.openFolder, copy.openLogs]);
    expect(buttons(copy.backToApp)).toHaveLength(1);
  });

  it("deduplicates pending-clip and orphan errors by recording identity", () => {
    props.actionErrors = {
      "native:native-clip": "Folder unavailable",
      "failure:native-clip": "Upload disconnected",
    };
    renderPage();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(buttons(copy.reviewFiles)).toHaveLength(0);
    expect(host.textContent).toContain(copy.folderOpenFailed);
    props.uploads = [];
    props.actionErrors = {
      "failure:orphan": "Save failed",
      "native:orphan": "Folder unavailable",
    };
    renderPage();
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    openMore();
    selectMenu(copy.reviewFiles);
    expect(props.onReviewFiles).toHaveBeenCalledWith("native:orphan");
  });

  it("exposes lookup diagnostics and full ordinary status on keyboard focus", async () => {
    props.uploads = [{ ...browser, lastError: null }];
    props.lookupErrors = [
      { kind: "native", cause: new Error("Native drafts lookup rejected") },
    ];
    renderPage();
    const descriptions = host.querySelectorAll(
      '[data-slot="item-description"]',
    );
    expect(descriptions[0].getAttribute("tabindex")).toBe("0");
    expect(descriptions[1].getAttribute("tabindex")).toBe("0");
    await openDiagnostic();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Native drafts lookup rejected",
    );
    await openDiagnostic(1);
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      copy.uploadPending,
    );
  });

  it("keeps a long retry status available in the tooltip without a stale error", async () => {
    props.uploads = [native];
    props.retryingUploadId = "native:native-clip";
    props.retryingUploadStatus =
      "Resuming upload · waiting for server verification";
    renderPage();
    await openDiagnostic();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      props.retryingUploadStatus,
    );
    expect(document.body.textContent).not.toContain(native.lastError);
  });

  it("exposes the full diagnostic on pointer hover", async () => {
    props.uploads = [native];
    renderPage();
    const event = new MouseEvent("pointermove", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    act(() => host.querySelector('[role="status"]')!.dispatchEvent(event));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
      native.lastError,
    );
  });

  it("keeps no-file recovery actions and their new failure diagnostics accessible", async () => {
    props.uploads = [];
    props.actionErrors = { "failure:no-file": "Writing recording failed" };
    renderPage();
    openMore();
    selectMenu(copy.reviewFiles);
    openMore();
    selectMenu(copy.openLogs);
    expect(props.onReviewFiles).toHaveBeenCalledWith("failure:no-file");
    expect(props.onOpenLogs).toHaveBeenCalledWith("failure:no-file");
    props.actionErrors = {
      "failure:no-file": "Could not open recovery folder",
    };
    renderPage();
    expect(host.textContent).toContain(copy.folderOpenFailed);
    await openDiagnostic();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Could not open recovery folder",
    );
  });

  it("shows neutral finalization without counting its metadata as failed", () => {
    props.uploads = [{ ...native, lastError: null }, browser];
    props.finalizing = true;
    props.finalizingRecordingId = native.recordingId;
    act(() => root.render(<RecordingRecovery {...props} onOpen={vi.fn()} />));
    expect(host.textContent).toBe(copy.attentionOne);
    renderPage();
    expect(host.textContent).toContain(copy.finishing);
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(buttons(copy.retry)[0].disabled).toBe(true);
  });

  it("keeps ongoing retry cancellable when revisiting recovery and hides its prior failure", () => {
    props.uploads = [native];
    props.retryingUploadId = "native:native-clip";
    props.retryingUploadStatus = "Uploading 50%";
    act(() => root.render(<RecordingRecovery {...props} onOpen={vi.fn()} />));
    expect(host.querySelector("button > span.flex-1")?.textContent).toBe(
      copy.retrying,
    );
    renderPage();
    expect(host.textContent).not.toContain(native.lastError);
    expect(host.textContent).toContain("Uploading 50%");
    act(() => buttons(copy.cancelRetry)[0].click());
    expect(props.onCancelRetry).toHaveBeenCalledWith(native);
  });

  it("exposes storage connection for the affected clip", () => {
    props.actionErrors = { "native:native-clip": "Connect storage" };
    renderPage();
    expect(host.textContent).toContain(copy.storageRequired);
    openMore();
    selectMenu(copy.connectStorage);
    expect(props.onConnectStorage).toHaveBeenCalledWith(native);
  });

  it("renders a neutral empty page after issues are resolved without losing Back", () => {
    props.uploads = [];
    const onBack = vi.fn();
    renderPage(onBack);
    expect(host.textContent).toContain(copy.noIssues);
    const back = buttons(copy.backToApp)[0];
    expect(host.querySelector("h2")).toBeNull();
    expect(document.activeElement).toBe(back);
    act(() => back.click());
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each(["recorder", "settings"] as const)(
    "returns to %s, restores trigger focus, and keeps setup state",
    (origin) => {
      function Harness() {
        const [view, setView] = useState<"recorder" | "settings" | "recovery">(
          origin,
        );
        const [source, setSource] = useState("full-screen");
        const rootRef = useRef<HTMLDivElement>(null);
        const navigation = useRecordingRecoveryNavigation(
          view,
          setView,
          rootRef,
        );
        return (
          <div ref={rootRef}>
            {view === "recovery" ? (
              <RecordingRecoveryPage
                {...props}
                onBack={navigation.closeRecovery}
              />
            ) : (
              <>
                <output>{view + ":" + source}</output>
                <button onClick={() => setSource("window")}>
                  Choose Window
                </button>
                <RecordingRecovery
                  {...props}
                  onOpen={navigation.openRecovery}
                  triggerRef={navigation.triggerRef}
                />
              </>
            )}
          </div>
        );
      }
      act(() => root.render(<Harness />));
      act(() => buttons("Choose Window")[0].click());
      act(() => buttons("2 clips need attention")[0].click());
      const back = buttons(copy.backToApp)[0];
      expect(document.activeElement).toBe(back);
      expect(host.querySelector("output")).toBeNull();
      act(() => back.click());
      expect(host.querySelector("output")?.textContent).toBe(
        origin + ":window",
      );
      expect(document.activeElement).toBe(buttons("2 clips need attention")[0]);
    },
  );
});

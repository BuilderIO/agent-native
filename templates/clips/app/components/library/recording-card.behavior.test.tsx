// @vitest-environment happy-dom

import { useLabState } from "@agent-native/core/client/labs";
import { RETRYABLE_UPLOAD_INTERRUPTION_REASON } from "@shared/upload-interruption";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordingSummary } from "@/hooks/use-library";
import { hasRecordingBackup } from "@/lib/recording-backup";
import { getRecordingUploadRecoveryEnabled } from "@/lib/recording-recovery-policy";
import { isStaleRecordingUpload } from "@/lib/recording-status";

import { RecordingCard } from "./recording-card";

const recordingBackupMock = vi.hoisted(() => ({
  changeListener: undefined as (() => void) | undefined,
}));

vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: vi.fn(() => ({
    isSuccess: true,
    source: "choice",
    enabled: true,
  })),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: () => "date",
    formatRelativeTime: () => "relative",
  }),
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/player/agent-view-count", () => ({
  AgentViewCount: () => null,
}));

vi.mock("@/components/sharing/viewed-by-popover", () => ({
  ViewedByPopover: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  AvatarFallback: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} />
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="checkbox" {...props} />
  ),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

vi.mock("@/lib/capture-install-options", () => ({
  attemptOpenDesktopApp: vi.fn(),
}));

vi.mock("@/lib/recording-status", () => ({
  isStaleRecordingUpload: vi.fn(() => false),
  isAtRiskRecordingUpload: vi.fn(() => false),
}));

vi.mock("@/lib/recording-backup", () => ({
  hasRecordingBackup: vi.fn(() => Promise.resolve(false)),
  subscribeToRecordingBackupChanges: vi.fn(
    (_recordingId: string, listener: () => void) => {
      recordingBackupMock.changeListener = listener;
      return vi.fn();
    },
  ),
}));

vi.mock("@/lib/recording-recovery-policy", () => ({
  getRecordingUploadRecoveryEnabled: vi.fn(async () => true),
}));

vi.mock("@/lib/storage-failures", () => ({
  isStorageSetupFailureReason: () => false,
}));

const recording: RecordingSummary = {
  id: "recording-1",
  title: "Test recording",
  description: "",
  kind: "video",
  thumbnailUrl: null,
  animatedThumbnailUrl: null,
  durationMs: 1_000,
  effectiveDurationMs: 1_000,
  status: "ready",
  visibility: "private",
  hasPassword: false,
  expiresAt: null,
  ownerEmail: "owner@example.com",
  folderId: null,
  spaceIds: [],
  tags: [],
  viewCount: 0,
  agentViewCount: 0,
  createdAt: "2026-08-18T12:00:00.000Z",
  updatedAt: "2026-08-18T12:00:00.000Z",
  archivedAt: null,
  trashedAt: null,
  hasAudio: false,
  hasCamera: false,
  width: 1280,
  height: 720,
};

describe("RecordingCard behavior", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    recordingBackupMock.changeListener = undefined;
    vi.mocked(useLabState).mockReturnValue({
      isSuccess: true,
      source: "choice",
      enabled: true,
    } as ReturnType<typeof useLabState>);
    vi.mocked(isStaleRecordingUpload).mockReturnValue(false);
    vi.mocked(hasRecordingBackup).mockResolvedValue(false);
    vi.mocked(getRecordingUploadRecoveryEnabled).mockResolvedValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("does not offer retry for a permanent failed upload", async () => {
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: "File storage is not configured.",
          }}
          onRetry={onRetry}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("clipsFinalRaw.retry");
    expect(hasRecordingBackup).not.toHaveBeenCalled();
  });

  it("offers retry for a retryable interrupted upload with a local backup", async () => {
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
          }}
          onRetry={onRetry}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("clipsFinalRaw.retry");
    expect(hasRecordingBackup).toHaveBeenCalledWith(recording.id);
    expect(getRecordingUploadRecoveryEnabled).toHaveBeenCalledWith(
      recording.id,
    );
  });

  it("does not offer Retry for a new Off recording with a backup", async () => {
    vi.mocked(useLabState).mockReturnValue({
      isSuccess: true,
      source: "choice",
      enabled: false,
    } as ReturnType<typeof useLabState>);
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    vi.mocked(getRecordingUploadRecoveryEnabled).mockResolvedValue(false);

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
          }}
          onRetry={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(getRecordingUploadRecoveryEnabled).toHaveBeenCalledWith(
      recording.id,
    );
    expect(container.textContent).not.toContain("clipsFinalRaw.retry");
  });

  it("keeps a recording created Off non-retryable when Labs is later On", async () => {
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    vi.mocked(getRecordingUploadRecoveryEnabled).mockResolvedValue(false);

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
          }}
          onRetry={vi.fn()}
        />,
      );
    });

    expect(getRecordingUploadRecoveryEnabled).toHaveBeenCalledWith(
      recording.id,
    );
    expect(container.textContent).not.toContain("clipsFinalRaw.retry");
  });

  it("withholds Retry while the saved policy is loading with Labs On", async () => {
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    let resolvePolicy!: (enabled: boolean) => void;
    vi.mocked(getRecordingUploadRecoveryEnabled).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolvePolicy = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
          }}
          onRetry={vi.fn()}
        />,
      );
    });

    expect(container.textContent).not.toContain("clipsFinalRaw.retry");

    await act(async () => resolvePolicy(true));

    expect(container.textContent).toContain("clipsFinalRaw.retry");
  });

  it("rechecks unsnapshotted uploads when inherited Off becomes an explicit choice", async () => {
    vi.mocked(useLabState).mockReturnValue({
      isSuccess: true,
      source: "legacy",
      enabled: false,
      legacyValues: {
        useCustomSCKPipeline: false,
        customSCKPipelineLiveUploadEnabled: false,
        uploadRetryResume: false,
      },
    } as ReturnType<typeof useLabState>);
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    vi.mocked(getRecordingUploadRecoveryEnabled)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onRetry = vi.fn();
    const props = {
      recording: {
        ...recording,
        status: "failed" as const,
        failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
      },
      onRetry,
    };

    await act(async () => root.render(<RecordingCard {...props} />));

    expect(container.textContent).not.toContain("clipsFinalRaw.retry");

    vi.mocked(useLabState).mockReturnValue({
      isSuccess: true,
      source: "choice",
      enabled: false,
    } as ReturnType<typeof useLabState>);

    await act(async () => root.render(<RecordingCard {...props} />));

    expect(getRecordingUploadRecoveryEnabled).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("clipsFinalRaw.retry");
  });

  it("offers retry when a local backup finishes after the card mounts", async () => {
    vi.mocked(hasRecordingBackup)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
          }}
          onRetry={onRetry}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "clipsFinalRaw.retryUnavailableHere",
    );
    expect(container.textContent).not.toContain("clipsFinalRaw.retrying");

    await act(async () => {
      recordingBackupMock.changeListener?.();
      await Promise.resolve();
    });

    expect(hasRecordingBackup).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("clipsFinalRaw.retry");
    expect(container.textContent).not.toContain(
      "clipsFinalRaw.retryUnavailableHere",
    );
  });

  it("keeps an interrupted recording with a saved backup retryable after Labs is Off", async () => {
    vi.mocked(useLabState).mockReturnValue({
      isSuccess: true,
      source: "choice",
      enabled: false,
    } as ReturnType<typeof useLabState>);
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            status: "failed",
            failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
          }}
          onRetry={onRetry}
        />,
      );
      await Promise.resolve();
    });

    expect(useLabState).toHaveBeenCalledWith("clips.resilient-recording");
    expect(container.textContent).toContain("clipsFinalRaw.retry");
    expect(hasRecordingBackup).toHaveBeenCalledWith(recording.id);
    expect(getRecordingUploadRecoveryEnabled).toHaveBeenCalledWith(
      recording.id,
    );
  });

  it("does not offer retry for a stale processing upload", async () => {
    vi.mocked(isStaleRecordingUpload).mockReturnValue(true);
    vi.mocked(hasRecordingBackup).mockResolvedValue(true);
    const onRetry = vi.fn();

    await act(async () => {
      root.render(
        <RecordingCard
          recording={{ ...recording, status: "processing" }}
          onRetry={onRetry}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("clipsFinalRaw.retry");
    expect(hasRecordingBackup).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "shows a failed policy check when Labs is %s",
    async (enabled) => {
      vi.mocked(useLabState).mockReturnValue({
        isSuccess: true,
        source: "choice",
        enabled,
      } as ReturnType<typeof useLabState>);
      vi.mocked(hasRecordingBackup).mockResolvedValue(true);
      vi.mocked(getRecordingUploadRecoveryEnabled).mockRejectedValueOnce(
        new Error("Stored recording recovery policy is unreadable"),
      );

      await act(async () => {
        root.render(
          <RecordingCard
            recording={{
              ...recording,
              status: "failed",
              failureReason: RETRYABLE_UPLOAD_INTERRUPTION_REASON,
            }}
            onRetry={vi.fn()}
          />,
        );
      });

      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "clipsFinalRaw.retryCheckFailed",
      );
      expect(container.textContent).not.toContain(
        "clipsFinalRaw.retryUnavailableHere",
      );
      expect(container.querySelector("button")?.textContent).not.toBe(
        "clipsFinalRaw.retry",
      );
    },
  );

  it("keeps screenshot cards free of playback duration", () => {
    act(() => {
      root.render(
        <RecordingCard recording={{ ...recording, kind: "image" }} />,
      );
    });

    expect(container.textContent).not.toContain("0:01");
  });

  it("localizes the shared default recording title", () => {
    act(() => {
      root.render(
        <RecordingCard
          recording={{ ...recording, title: "Untitled recording" }}
        />,
      );
    });

    expect(container.querySelector("a")?.getAttribute("aria-label")).toBe(
      "editableTitle.untitled",
    );
  });

  it("keeps checkboxes visible while recordings are being selected", () => {
    act(() => {
      root.render(
        <RecordingCard
          recording={recording}
          selectionMode
          onToggleSelect={vi.fn()}
        />,
      );
    });

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );

    expect(checkbox?.className).toContain("sm:opacity-100");
    expect(checkbox?.className).not.toContain("sm:opacity-0");
  });

  it("keeps the static thumbnail when the pointer enters a card", () => {
    const thumbnailUrl = "/api/thumbnail/recording-1";

    act(() => {
      root.render(
        <RecordingCard
          recording={{
            ...recording,
            thumbnailUrl,
            animatedThumbnailUrl: "/api/thumbnail/recording-1?animated=1",
          }}
        />,
      );
    });

    const card = container.querySelector<HTMLElement>('[role="article"]');
    const thumbnail = card?.querySelector<HTMLImageElement>("img");
    expect(thumbnail?.getAttribute("src")).toBe(thumbnailUrl);

    act(() => {
      card?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    expect(thumbnail?.getAttribute("src")).toBe(thumbnailUrl);
  });

  it("defers trash until the dropdown menu has closed", async () => {
    const onTrash = vi.fn();

    act(() => {
      root.render(<RecordingCard recording={recording} onTrash={onTrash} />);
    });

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="clipsFinalRaw.recordingMenu"]',
    );
    expect(menuTrigger).not.toBeNull();

    await act(async () => {
      menuTrigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const deleteItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) =>
      item.textContent?.includes("libraryGrid.moveToTrashAction"),
    );
    expect(deleteItem).not.toBeUndefined();

    act(() => deleteItem?.click());
    expect(onTrash).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onTrash).toHaveBeenCalledTimes(1);
    expect(onTrash).toHaveBeenCalledWith(recording);
  });
});

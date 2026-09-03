// @vitest-environment happy-dom

import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import { RETRYABLE_UPLOAD_INTERRUPTION_REASON } from "@shared/upload-interruption";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordingSummary } from "@/hooks/use-library";
import { hasRecordingBackup } from "@/lib/recording-backup";
import { isStaleRecordingUpload } from "@/lib/recording-status";

import { RecordingCard } from "./recording-card";

const recordingBackupMock = vi.hoisted(() => ({
  changeListener: undefined as (() => void) | undefined,
}));

vi.mock("@agent-native/core/client/feature-flags", () => ({
  useFeatureFlag: vi.fn(() => true),
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

vi.mock("@/components/player/recording-views-badge", () => ({
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
  Checkbox: () => <input type="checkbox" />,
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
}));

vi.mock("@/hooks/use-auto-title", () => ({
  isDefaultTitle: () => false,
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

vi.mock("@/lib/storage-failures", () => ({
  isStorageSetupFailureReason: () => false,
}));

const recording: RecordingSummary = {
  id: "recording-1",
  title: "Test recording",
  description: "",
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
    vi.mocked(useFeatureFlag).mockReturnValue(true);
    vi.mocked(isStaleRecordingUpload).mockReturnValue(false);
    vi.mocked(hasRecordingBackup).mockResolvedValue(false);
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

  it("does not offer retry when the resumable retry rollout is disabled", async () => {
    vi.mocked(useFeatureFlag).mockReturnValue(false);
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

    expect(useFeatureFlag).toHaveBeenCalledWith("uploadRetryResume");
    expect(container.textContent).not.toContain("clipsFinalRaw.retry");
    expect(hasRecordingBackup).not.toHaveBeenCalled();
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
    ).find((item) => item.textContent?.includes("folderTree.delete"));
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

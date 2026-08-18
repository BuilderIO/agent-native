// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecordingSummary } from "@/hooks/use-library";

import { RecordingCard } from "./recording-card";

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: () => "date",
    formatRelativeTime: () => "relative",
  }),
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  Link: ({ children, to, ...props }: React.ComponentProps<"a">) => (
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
  isStaleRecordingUpload: () => false,
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
  status: "ready",
  visibility: "private",
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

describe("RecordingCard delete menu", () => {
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
    vi.clearAllMocks();
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
    });

    expect(onTrash).toHaveBeenCalledTimes(1);
    expect(onTrash).toHaveBeenCalledWith(recording);
  });
});

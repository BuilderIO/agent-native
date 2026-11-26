// oracle-change: the inspector actions row became the right column head; zoom moved to the bottom toolbar and presence no longer has its own leading row
// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import { renderRightSidebarActions } from "./right-sidebar-actions";

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element is missing");
  return value;
}

type ActionsArgs = Parameters<typeof renderRightSidebarActions>[0];

function actionsArgs(overrides: Partial<ActionsArgs> = {}): ActionsArgs {
  return {
    editorCore: {
      t: (key: string) => key,
      hostEmbeddedEditor: false,
      sessionResolved: true,
      isSignedIn: true,
    } as unknown as EditorCore,
    editorHistory: {
      rightSidebarWidth: 280,
      commentsPanelOpen: false,
      setCommentsPanelOpen: vi.fn(),
    } as unknown as EditorHistory,
    renderPendingNodeRewriteControl: () => null,
    publishWaitlistControl: null,
    presenceControl: null,
    renderReviewFeedbackControl: () => null,
    renderShareControl: () => <button data-slot="share">Share</button>,
    localPreviewRow: null,
    showCommentsToggle: true,
    reviewUnreadCount: 0,
    ...overrides,
  };
}

async function mount(element: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TooltipProvider>{element}</TooltipProvider>);
  });
  return {
    host,
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

const slot = (host: HTMLElement, name: string) =>
  must(host.querySelector<HTMLElement>(`[data-slot="${name}"]`));

const headRow = (host: HTMLElement) =>
  must(
    host.querySelector('[data-design-chrome-region="right-toolbar-actions"]'),
  );

const follows = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("right column head", () => {
  it("puts Comments and Apply feedback at the start and presence, waitlist and Share at the end", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            presenceControl: <span data-slot="presence">AB</span>,
            publishWaitlistControl: <button data-slot="waitlist">Join</button>,
            renderReviewFeedbackControl: () => (
              <button data-slot="feedback">Apply</button>
            ),
          }),
        )}
      </>,
    );
    const row = headRow(host);
    const comments = must(row.querySelector("[data-design-comments-toggle]"));
    expect(comments).not.toBeNull();
    expect(follows(comments, slot(host, "feedback"))).toBe(true);
    expect(follows(slot(host, "feedback"), slot(host, "presence"))).toBe(true);
    expect(follows(slot(host, "presence"), slot(host, "waitlist"))).toBe(true);
    expect(follows(slot(host, "waitlist"), slot(host, "share"))).toBe(true);
    await unmount();
  });

  it("drops the Comments label into a tooltip on a narrow inspector or beside Apply feedback", async () => {
    const renderReviewFeedbackControl = vi.fn((compact: boolean) => (
      <button data-slot="feedback" data-compact={String(compact)}>
        Apply
      </button>
    ));
    const wide = await mount(<>{renderRightSidebarActions(actionsArgs())}</>);
    const wideToggle = must(
      wide.host.querySelector("[data-design-comments-toggle]"),
    );
    expect(wideToggle.textContent).toContain(
      "designEditor.columnHead.comments",
    );
    expect(wideToggle.getAttribute("aria-label")).toBeNull();
    await wide.unmount();

    const narrow = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            editorHistory: {
              rightSidebarWidth: 240,
              commentsPanelOpen: false,
              setCommentsPanelOpen: vi.fn(),
            } as unknown as EditorHistory,
          }),
        )}
      </>,
    );
    const narrowToggle = must(
      narrow.host.querySelector("[data-design-comments-toggle]"),
    );
    expect(narrowToggle.getAttribute("aria-label")).toBe(
      "designEditor.columnHead.comments",
    );
    expect(narrowToggle.textContent).not.toContain(
      "designEditor.columnHead.comments",
    );
    await narrow.unmount();

    const withFeedback = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({ renderReviewFeedbackControl }),
        )}
      </>,
    );
    expect(renderReviewFeedbackControl).toHaveBeenLastCalledWith(true);
    expect(
      must(
        withFeedback.host.querySelector("[data-design-comments-toggle]"),
      ).getAttribute("aria-label"),
    ).toBe("designEditor.columnHead.comments");
    await withFeedback.unmount();
  });

  it("names unread comments on the icon-only Comments button", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            reviewUnreadCount: 2,
            editorHistory: {
              rightSidebarWidth: 240,
              commentsPanelOpen: false,
              setCommentsPanelOpen: vi.fn(),
            } as unknown as EditorHistory,
          }),
        )}
      </>,
    );
    expect(
      must(host.querySelector("[data-design-comments-toggle]")).getAttribute(
        "aria-label",
      ),
    ).toBe(
      "designEditor.columnHead.comments, designEditor.columnHead.unreadComments",
    );
    await unmount();
  });

  it("keeps the waitlist CTA in the head while signed out", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            editorCore: {
              t: (key: string) => key,
              hostEmbeddedEditor: false,
              sessionResolved: true,
              isSignedIn: false,
            } as unknown as EditorCore,
            publishWaitlistControl: <button data-slot="waitlist">Join</button>,
          }),
        )}
      </>,
    );
    expect(headRow(host).contains(slot(host, "waitlist"))).toBe(true);
    await unmount();
  });

  it("toggles the comments panel and marks unread comments", async () => {
    const setCommentsPanelOpen = vi.fn();
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            editorHistory: {
              rightSidebarWidth: 280,
              commentsPanelOpen: false,
              setCommentsPanelOpen,
            } as unknown as EditorHistory,
            reviewUnreadCount: 2,
          }),
        )}
      </>,
    );
    const toggle = must(
      host.querySelector<HTMLButtonElement>("[data-design-comments-toggle]"),
    );
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      toggle.querySelector("[data-design-comments-unread-dot]"),
    ).not.toBeNull();
    await act(async () => {
      toggle.click();
    });
    expect(setCommentsPanelOpen).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it("puts a local preview row below the head", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            localPreviewRow: <div data-slot="preview">http://localhost</div>,
          }),
        )}
      </>,
    );
    expect(headRow(host).contains(slot(host, "preview"))).toBe(false);
    expect(follows(headRow(host), slot(host, "preview"))).toBe(true);
    await unmount();
  });
});

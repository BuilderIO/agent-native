// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import { renderRightSidebarActions } from "./right-sidebar-actions";

type ActionsArgs = Parameters<typeof renderRightSidebarActions>[0];

function actionsArgs(overrides: Partial<ActionsArgs> = {}): ActionsArgs {
  return {
    editorCore: {
      hostEmbeddedEditor: false,
      sessionResolved: true,
      isSignedIn: true,
    } as unknown as EditorCore,
    editorHistory: { rightSidebarWidth: 240 } as unknown as EditorHistory,
    renderZoomControl: () => <button data-slot="zoom">76%</button>,
    renderPendingNodeRewriteControl: () => null,
    publishWaitlistControl: null,
    presenceControl: null,
    reviewFeedbackControl: null,
    renderShareControl: () => <button data-slot="share">Share</button>,
    localPreviewRow: null,
    ...overrides,
  };
}

async function mount(element: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return {
    host,
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

const slot = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLElement>(`[data-slot="${name}"]`)!;

// Presence, the waitlist CTA, and everything else that leads the Share row are
// optional. The zoom field stays under whatever leads, and takes the lead's
// place on the Share row when nothing does.
describe("inspector actions row", () => {
  it("renders the zoom and Share in one row container", async () => {
    const { host, unmount } = await mount(
      <>{renderRightSidebarActions(actionsArgs())}</>,
    );
    const row = host.querySelector(
      '[data-design-chrome-region="right-toolbar-actions"]',
    )!;
    expect(row.contains(slot(host, "zoom"))).toBe(true);
    expect(row.contains(slot(host, "share"))).toBe(true);
    await unmount();
  });

  it("leaves the leading cluster empty when no presence leads the row", async () => {
    const { host, unmount } = await mount(
      <>{renderRightSidebarActions(actionsArgs())}</>,
    );
    const leading = host.querySelector("[data-design-right-toolbar-leading]")!;
    expect(leading.childNodes).toHaveLength(0);
    await unmount();
  });

  it("keeps the presence control in the leading cluster", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            presenceControl: <span data-slot="presence">AB</span>,
          }),
        )}
      </>,
    );
    const leading = host.querySelector("[data-design-right-toolbar-leading]")!;
    expect(leading.contains(slot(host, "presence"))).toBe(true);
    expect(leading.contains(slot(host, "zoom"))).toBe(false);
    await unmount();
  });

  it("fills the leading cluster with the waitlist CTA while signed out", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            editorCore: {
              hostEmbeddedEditor: false,
              sessionResolved: true,
              isSignedIn: false,
            } as unknown as EditorCore,
            publishWaitlistControl: <button data-slot="waitlist">Join</button>,
          }),
        )}
      </>,
    );
    const leading = host.querySelector("[data-design-right-toolbar-leading]")!;
    expect(leading.contains(slot(host, "waitlist"))).toBe(true);
    await unmount();
  });

  it("puts a local preview row after the leading and Share controls", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightSidebarActions(
          actionsArgs({
            localPreviewRow: <div data-slot="preview">http://localhost</div>,
          }),
        )}
      </>,
    );
    const row = host.querySelector(
      '[data-design-chrome-region="right-toolbar-actions"]',
    )!;
    expect(row.contains(slot(host, "preview"))).toBe(true);
    await unmount();
  });
});

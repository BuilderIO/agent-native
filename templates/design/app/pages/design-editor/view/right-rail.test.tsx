// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import type { EditorModes } from "../domains/use-editor-modes";
import { renderRightRail } from "./right-rail";

vi.mock("@/components/design/EditPanel", () => ({
  EditPanel: () => <div data-slot="edit-panel" />,
}));
vi.mock("@/components/design/editor/AgentNativeMenuMark", () => ({
  AgentNativeMenuMark: () => <span data-slot="menu-mark" />,
}));

type RailArgs = Parameters<typeof renderRightRail>[0];

function railArgs(overrides: {
  widgetEmbed: boolean;
  rightSidebarVisible: boolean;
  minimalUi?: boolean;
}): RailArgs {
  return {
    editorCore: {
      t: (key: string) => key,
      mode: "edit",
      hostOwnsChrome: false,
      widgetEmbed: overrides.widgetEmbed,
    } as unknown as EditorCore,
    editorHistory: {
      rightSidebarContentRef: { current: null },
      minimalUi: overrides.minimalUi ?? true,
      rightSidebarWidth: 240,
      startSidebarResize: vi.fn(),
    } as unknown as EditorHistory,
    editorContentAndComponents: {
      uiHidden: false,
    } as unknown as EditorContentAndComponents,
    editorModes: { responsiveInteractActive: false } as unknown as EditorModes,
    projectTitleControl: <button data-slot="title">Product Launch</button>,
    minimalUiToggle: <button data-slot="minimal-toggle" />,
    localPreviewRow: null,
    rightSidebarActions: <div data-slot="actions">Share</div>,
    topBarVisible: false,
    renderResponsiveInteractBar: () => <div />,
    rightSidebarVisible: overrides.rightSidebarVisible,
    editPanelProps: {} as RailArgs["editPanelProps"],
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

describe.each([
  ["an MCP widget", true],
  ["the standard editor", false],
])("minimal-UI right rail in %s", (_name, widgetEmbed) => {
  it("shows the title pill with the minimal-UI toggle", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(railArgs({ widgetEmbed, rightSidebarVisible: false }))}
      </>,
    );
    const pill = host.querySelector('[data-design-minimal-bar="left"]');
    expect(pill?.querySelector('[data-slot="title"]')?.textContent).toBe(
      "Product Launch",
    );
    expect(pill?.querySelector('[data-slot="minimal-toggle"]')).not.toBeNull();
    await unmount();
  });

  it("shows the right pill with Share while no inspector is open", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(railArgs({ widgetEmbed, rightSidebarVisible: false }))}
      </>,
    );
    expect(
      host.querySelector(
        '[data-design-minimal-bar="right"] [data-slot="actions"]',
      ),
    ).not.toBeNull();
    await unmount();
  });

  it("keeps the same floating bar offset and inspector box", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(railArgs({ widgetEmbed, rightSidebarVisible: true }))}
      </>,
    );
    const bar = host.querySelector<HTMLElement>(
      "[data-design-minimal-ui] > div",
    );
    expect(bar?.style.paddingTop).toBe("");
    const panel = host.querySelector<HTMLElement>(
      '[data-design-chrome-region="right-panel"]',
    );
    expect(panel?.style.top).toBe("");
    expect(panel?.style.width).toBe("240px");
    expect(panel?.querySelector('[data-slot="edit-panel"]')).not.toBeNull();
    expect(panel?.querySelector('[data-slot="actions"]')).not.toBeNull();
    await unmount();
  });
});

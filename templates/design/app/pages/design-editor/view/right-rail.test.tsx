// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { EditorContentAndComponents } from "../domains/use-editor-content-and-components";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorHistory } from "../domains/use-editor-history";
import { renderRightRail } from "./right-rail";

vi.mock("@/components/design/EditPanel", () => ({
  EditPanel: () => <div data-slot="edit-panel" />,
}));
vi.mock("@/components/design/editor/AgentNativeMenuMark", () => ({
  AgentNativeMenuMark: () => <span data-slot="menu-mark" />,
}));

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected element is missing");
  return value;
}

type RailArgs = Parameters<typeof renderRightRail>[0];

function railArgs(overrides: {
  widgetEmbed: boolean;
  rightSidebarVisible: boolean;
  minimalUi?: boolean;
  interactFloatingBar?: ReactElement | null;
  commentsPanelOpen?: boolean;
  isMobileViewport?: boolean;
  activeLeftPanel?: string | null;
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
      setRightSidebarWidth: vi.fn(),
      startSidebarResize: vi.fn(),
      commentsPanelOpen: overrides.commentsPanelOpen ?? false,
      isMobileViewport: overrides.isMobileViewport ?? false,
      activeLeftPanel: overrides.activeLeftPanel ?? null,
    } as unknown as EditorHistory,
    editorContentAndComponents: {
      uiHidden: false,
    } as unknown as EditorContentAndComponents,
    projectTitleControl: <button data-slot="title">Product Launch</button>,
    minimalUiToggle: <button data-slot="minimal-toggle" />,
    rightSidebarActions: <div data-slot="actions">Share</div>,
    interactFloatingBar: overrides.interactFloatingBar ?? null,
    rightSidebarVisible: overrides.rightSidebarVisible,
    floatingHeadAllowed: true,
    commentsPanel: <div data-slot="comments-panel" />,
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

describe("Interact floating bar in the right rail", () => {
  const interactBar = <div data-slot="interact-bar" />;

  it("sits in the minimal-UI bar's centre", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(
          railArgs({
            widgetEmbed: false,
            rightSidebarVisible: false,
            interactFloatingBar: interactBar,
          }),
        )}
      </>,
    );
    expect(
      host.querySelector(
        '[data-design-minimal-bar="interact"] [data-slot="interact-bar"]',
      ),
    ).not.toBeNull();
    expect(host.querySelector("[data-design-interact-floating]")).toBeNull();
    await unmount();
  });

  it("floats over the canvas where the docked editor has no top bar", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(
          railArgs({
            widgetEmbed: false,
            rightSidebarVisible: false,
            minimalUi: false,
            interactFloatingBar: interactBar,
          }),
        )}
      </>,
    );
    expect(
      host.querySelector(
        '[data-design-interact-floating] [data-slot="interact-bar"]',
      ),
    ).not.toBeNull();
    expect(host.querySelector("[data-design-minimal-ui]")).toBeNull();
    await unmount();
  });
});

describe("right column", () => {
  it("puts the head above the inspector and a keyboard separator on its inner edge", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(
          railArgs({
            widgetEmbed: false,
            rightSidebarVisible: true,
            minimalUi: false,
          }),
        )}
      </>,
    );
    const panel = must(
      host.querySelector<HTMLElement>(
        '[data-design-chrome-region="right-panel"]',
      ),
    );
    expect(panel.querySelector('[data-slot="actions"]')).not.toBeNull();
    expect(panel.querySelector('[data-slot="edit-panel"]')).not.toBeNull();
    const handle = must(panel.querySelector('[role="separator"]'));
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("aria-valuemin")).toBe("240");
    expect(handle.getAttribute("aria-valuemax")).toBe("400");
    await unmount();
  });

  it("shows Comments in place of the inspector while open", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(
          railArgs({
            widgetEmbed: false,
            rightSidebarVisible: true,
            minimalUi: false,
            commentsPanelOpen: true,
          }),
        )}
      </>,
    );
    expect(host.querySelector('[data-slot="comments-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="edit-panel"]')).toBeNull();
    await unmount();
  });

  it("floats the head where the column is absent outside minimal UI", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(
          railArgs({
            widgetEmbed: false,
            rightSidebarVisible: false,
            minimalUi: false,
          }),
        )}
      </>,
    );
    expect(
      host.querySelector(
        '[data-design-floating-right-head] [data-slot="actions"]',
      ),
    ).not.toBeNull();
    await unmount();
  });

  it("keeps the floating head off a phone's open left drawer", async () => {
    const { host, unmount } = await mount(
      <>
        {renderRightRail(
          railArgs({
            widgetEmbed: false,
            rightSidebarVisible: false,
            minimalUi: false,
            isMobileViewport: true,
            activeLeftPanel: "file",
          }),
        )}
      </>,
    );
    expect(host.querySelector("[data-design-floating-right-head]")).toBeNull();
    await unmount();
  });
});

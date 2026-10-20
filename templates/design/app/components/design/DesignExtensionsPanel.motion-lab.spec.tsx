// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  useAgentEngineConfigured: () => ({ state: "unconfigured" }),
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useChangeVersions: () => 0,
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: [], isLoading: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/components/ui/dropdown-menu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/dropdown-menu")>()),
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
}));

import type { DesignExtensionSlotContext } from "./DesignExtensionsPanel";
import { DesignExtensionsPanel } from "./DesignExtensionsPanel";

const context: DesignExtensionSlotContext = {
  designId: "design_1",
  designTitle: "Test design",
  activeFileId: "file_1",
  activeFilename: "index.html",
  activeFileUpdatedAt: null,
  activeContent: "",
  viewMode: "single",
  zoom: 1,
  screens: [],
  selectedScreenIds: [],
  selectedElement: null,
  mode: "edit",
  activeTool: "select",
  tweakValues: {},
};

describe("DesignExtensionsPanel Motion Lab gate", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function renderPanel(motionLabEnabled: boolean) {
    act(() =>
      root.render(
        <DesignExtensionsPanel
          context={context}
          motionLabEnabled={motionLabEnabled}
          hideAssetLibrary
        />,
      ),
    );
  }

  function categoryTrigger() {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => !button.hasAttribute("role"))
      .find((button) => {
        const label = button.textContent?.trim();
        return label === "All categories" || label === "Motion";
      });
  }

  function categoryOptions() {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent?.trim());
  }

  it("shows Motion only with the Lab enabled and clears a stale Motion filter when disabled", () => {
    renderPanel(false);
    expect(container.textContent).not.toContain("Motion Presets");
    expect(categoryOptions()).not.toContain("Motion");

    renderPanel(true);
    expect(container.textContent).toContain("Motion Presets");
    const motionOption = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Motion");
    expect(motionOption).toBeDefined();
    act(() => motionOption?.click());

    expect(categoryTrigger()?.textContent).toContain("Motion");
    expect(container.textContent).toContain("Motion Presets");

    renderPanel(false);
    expect(categoryTrigger()?.textContent).toContain("All categories");
    expect(container.textContent).not.toContain("Motion Presets");
    expect(categoryOptions()).not.toContain("Motion");
  });
});

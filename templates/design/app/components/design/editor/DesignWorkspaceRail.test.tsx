// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DesignWorkspaceRail } from "./DesignWorkspaceRail";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function renderRail(activePanel: "file" | "agent" | null) {
  const onPanelChange = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const mount = async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <DesignWorkspaceRail
            activePanel={activePanel}
            projectMenu={null}
            onPanelChange={onPanelChange}
          />
        </TooltipProvider>,
      );
    });
  };

  const click = async (label: string) => {
    const button = host.querySelector(`button[aria-label="${label}"]`);
    if (!button) throw new Error(`no button labelled ${label}`);
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };

  return { click, host, onPanelChange, root, mount };
}

describe("DesignWorkspaceRail", () => {
  it("collapses the active panel when its rail tab is clicked again", async () => {
    const rail = renderRail("file");
    await rail.mount();
    await rail.click("designEditor.leftRail.file");

    expect(rail.onPanelChange).toHaveBeenCalledWith(null);
    rail.root.unmount();
  });

  it("opens the clicked panel when another panel is active", async () => {
    const rail = renderRail("file");
    await rail.mount();
    await rail.click("designEditor.leftRail.agent");

    expect(rail.onPanelChange).toHaveBeenCalledWith("agent");
    rail.root.unmount();
  });
});

// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { DesignWorkspaceRail } from "./DesignWorkspaceRail";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const orgSwitcherProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/toolkit/app/org", () => ({
  OrgSwitcher: (props: Record<string, unknown>) => {
    orgSwitcherProps.current = props;
    return <button type="button" data-testid="org-switcher" />;
  },
}));

function renderRail(
  activePanel: "file" | "agent" | "threads" | null,
  onMotionToggle?: () => void,
  showAccountMenu?: boolean,
) {
  const onPanelChange = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const mount = async () => {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <DesignWorkspaceRail
            showAccountMenu={showAccountMenu}
            activePanel={activePanel}
            motionOpen={false}
            onMotionToggle={onMotionToggle}
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
    await rail.click("designEditor.leftRail.layers");

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

  it("opens the Motion dock from its workspace rail control", async () => {
    const onMotionToggle = vi.fn();
    const rail = renderRail("file", onMotionToggle);
    await rail.mount();
    await rail.click("designEditor.motion.dockLabel");

    expect(onMotionToggle).toHaveBeenCalledOnce();
    rail.root.unmount();
  });

  it("lists Layers, Agent, Tokens and Threads, in that order", async () => {
    const rail = renderRail("file");
    await rail.mount();

    const labels = Array.from(
      rail.host.querySelectorAll("nav button[aria-label]"),
    ).map((button) => button.getAttribute("aria-label"));
    expect(labels.slice(0, 4)).toEqual([
      "designEditor.leftRail.layers",
      "designEditor.leftRail.agent",
      "designEditor.leftRail.tokens",
      "designEditor.leftRail.threads",
    ]);
    rail.root.unmount();
  });

  it("opens Threads from the rail and collapses it when clicked again", async () => {
    const opened = renderRail("file");
    await opened.mount();
    await opened.click("designEditor.leftRail.threads");
    expect(opened.onPanelChange).toHaveBeenCalledWith("threads");
    opened.root.unmount();

    const collapsed = renderRail("threads");
    await collapsed.mount();
    await collapsed.click("designEditor.leftRail.threads");
    expect(collapsed.onPanelChange).toHaveBeenCalledWith(null);
    collapsed.root.unmount();
  });

  it("mounts the shared compact account menu above the collapse control", async () => {
    const rail = renderRail("file", undefined, true);
    await rail.mount();

    const switcher = rail.host.querySelector(
      'nav [data-testid="org-switcher"]',
    );
    const collapse = rail.host.querySelector(
      'nav button[aria-label="designEditor.leftRail.collapse"]',
    );
    expect(switcher).not.toBeNull();
    expect(orgSwitcherProps.current).toMatchObject({
      compact: true,
      hideBuilderCreditNotice: true,
    });
    expect(
      switcher!.compareDocumentPosition(collapse!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(rail.host.querySelector('a[href="/settings"]')).toBeNull();
    rail.root.unmount();
  });

  it("omits the account menu when the rail is not showing one", async () => {
    const rail = renderRail("file");
    await rail.mount();

    expect(rail.host.querySelector('[data-testid="org-switcher"]')).toBeNull();
    rail.root.unmount();
  });
});

// @vitest-environment happy-dom

import type { InteractPreviewTheme } from "@shared/preview-color-scheme";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { renderInteractFloatingBar } from "./responsive-interact-toolbar";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const unmounts: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (unmounts.length) await unmounts.pop()!();
});

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TooltipProvider>{node}</TooltipProvider>);
  });
  unmounts.push(() =>
    act(async () => root.unmount()).then(() => host.remove()),
  );
  return host;
}

function makeArgs() {
  const editorModes = {
    interactZoom: 67,
    interactScreens: [
      { screenId: "home", title: "Home" },
      { screenId: "docs", title: "Docs" },
    ],
    canGoBackInteractScreen: true,
    canGoForwardInteractScreen: false,
    handleInteractScreenSelect: vi.fn(),
    handleInteractScreenBack: vi.fn(),
    handleInteractScreenForward: vi.fn(),
    handleScreenReload: vi.fn(),
    handleInteractThemeChange: vi.fn(),
    handleExitResponsiveInteract: vi.fn(),
    interactPreviewTheme: {
      scheme: "light",
      displayMode: "light",
      pickerVisible: true,
      darkAvailable: true,
    } as InteractPreviewTheme,
  };
  const editorActiveScreenAndGeometry = {
    interactDeviceName: 'MacBook Air 13"',
    interactDeviceSize: { width: 1440, height: 900 },
    handleInteractDeviceChange: vi.fn(),
  };
  return {
    editorModes,
    editorActiveScreenAndGeometry,
    activeScreenId: "home",
  };
}

type Args = ReturnType<typeof makeArgs>;
const asArgs = (args: Args) =>
  args as unknown as Parameters<typeof renderInteractFloatingBar>[0];

// oracle-change: the docked top bar is gone, so renderInteractTopBarSlots and its slot tests are deleted; the back, forward and reload wiring test now runs on the floating bar, the only surface left
describe("renderInteractFloatingBar", () => {
  it("leaves the theme picker out when the screen cannot take a theme", async () => {
    const args = makeArgs();
    args.editorModes.interactPreviewTheme = {
      scheme: null,
      displayMode: "light",
      pickerVisible: false,
      darkAvailable: false,
    };
    const host = await mount(renderInteractFloatingBar(asArgs(args)));
    expect(host.querySelector("[data-design-interact-theme]")).toBeNull();
    expect(host.querySelector("[data-design-interact-device]")).not.toBeNull();
    expect(host.querySelector("[data-design-interact-route]")).not.toBeNull();
  });

  it("carries the same controls plus an Exit wired to leaving Interact", async () => {
    const args = makeArgs();
    const host = await mount(renderInteractFloatingBar(asArgs(args)));
    expect(host.querySelector("[data-design-interact-device]")).not.toBeNull();
    expect(host.querySelector("[data-design-interact-theme]")).not.toBeNull();
    expect(host.querySelector("[data-design-interact-route]")).not.toBeNull();
    await act(async () => {
      host
        .querySelector(
          "button[aria-label='designEditor.responsiveInteract.exit']",
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(args.editorModes.handleExitResponsiveInteract).toHaveBeenCalledTimes(
      1,
    );
  });

  it("wires back, forward and reload to the editor's handlers", async () => {
    const args = makeArgs();
    const host = await mount(renderInteractFloatingBar(asArgs(args)));
    const press = async (label: string) => {
      await act(async () => {
        host
          .querySelector(
            `button[aria-label='designEditor.responsiveInteract.${label}']`,
          )
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    await press("back");
    await press("forward");
    await press("reload");
    expect(args.editorModes.handleInteractScreenBack).toHaveBeenCalledTimes(1);
    expect(args.editorModes.handleInteractScreenForward).not.toHaveBeenCalled();
    expect(args.editorModes.handleScreenReload).toHaveBeenCalledTimes(1);
  });
});

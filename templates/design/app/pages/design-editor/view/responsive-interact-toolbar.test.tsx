// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  renderInteractFloatingBar,
  renderInteractTopBarSlots,
} from "./responsive-interact-toolbar";

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
    interactRoutes: [
      { screenId: "home", route: "/home", title: "Home" },
      { screenId: "docs", route: "/docs", title: "Docs" },
    ],
    canGoBackInteractRoute: true,
    canGoForwardInteractRoute: false,
    handleInteractRouteSelect: vi.fn(),
    handleInteractRouteBack: vi.fn(),
    handleInteractRouteForward: vi.fn(),
    handleScreenReload: vi.fn(),
    handleInteractThemeChange: vi.fn(),
    handleExitResponsiveInteract: vi.fn(),
    interactPreviewTheme: {
      scheme: "light",
      displayMode: "light",
      canPick: true,
      darkAvailable: true,
    },
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
  args as unknown as Parameters<typeof renderInteractTopBarSlots>[0];

describe("renderInteractTopBarSlots", () => {
  it("fills the leading, centre and zoom slots from the editor's state", async () => {
    const args = makeArgs();
    const slots = renderInteractTopBarSlots(asArgs(args));
    const host = await mount(
      <>
        <div data-slot="leading">{slots.leading}</div>
        <div data-slot="center">{slots.center}</div>
        <div data-slot="zoom">{slots.zoomControl}</div>
      </>,
    );
    const within = (slot: string) =>
      host.querySelector<HTMLElement>(`[data-slot=${slot}]`)!;

    expect(
      within("leading").querySelector("[data-design-interact-device]")
        ?.textContent,
    ).toContain('MacBook Air 13"');
    expect(
      within("leading").querySelector("[data-design-interact-theme]"),
    ).not.toBeNull();
    expect(
      within("center").querySelector("[data-design-interact-route]")
        ?.textContent,
    ).toContain("/home");
    expect(within("zoom").textContent).toBe("67%");
  });

  it("has no Exit: the mode switch beside it is the way out", async () => {
    const slots = renderInteractTopBarSlots(asArgs(makeArgs()));
    const host = await mount(
      <>
        {slots.leading}
        {slots.center}
        {slots.zoomControl}
      </>,
    );
    expect(
      host.querySelector(
        "button[aria-label='designEditor.responsiveInteract.exit']",
      ),
    ).toBeNull();
  });

  it("wires back, forward and reload to the editor's handlers", async () => {
    const args = makeArgs();
    const slots = renderInteractTopBarSlots(asArgs(args));
    const host = await mount(<>{slots.center}</>);
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
    expect(args.editorModes.handleInteractRouteBack).toHaveBeenCalledTimes(1);
    // Forward is disabled while there is no forward entry.
    expect(args.editorModes.handleInteractRouteForward).not.toHaveBeenCalled();
    expect(args.editorModes.handleScreenReload).toHaveBeenCalledTimes(1);
  });
});

describe("renderInteractFloatingBar", () => {
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
});

// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { EditorMode } from "@/pages/design-editor/types";

import { EditorTopBar } from "./EditorTopBar";
import {
  InteractDevicePicker,
  InteractFloatingBar,
  InteractRouteControls,
  InteractThemePicker,
  InteractZoomReadout,
} from "./InteractControls";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<TooltipProvider>{node}</TooltipProvider>);
  });
  return {
    host,
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

const noop = () => {};

function interactTopBar(onModeChange: (mode: EditorMode) => void) {
  return (
    <EditorTopBar
      mode="interact"
      onModeChange={onModeChange}
      leftInset={344}
      narrowLeftInset={64}
      leading={
        <>
          <InteractDevicePicker
            deviceName="iPhone 17"
            width={402}
            height={874}
            onChange={noop}
          />
          <InteractThemePicker
            mode="light"
            canPick
            darkAvailable
            onChange={noop}
          />
        </>
      }
      center={
        <InteractRouteControls
          routes={[{ screenId: "home", route: "/home", title: "Home" }]}
          activeScreenId="home"
          canGoBack={false}
          canGoForward={false}
          onSelect={noop}
          onBack={noop}
          onForward={noop}
          onReload={noop}
        />
      }
      zoomControl={<InteractZoomReadout zoom={67} />}
    />
  );
}

describe("Interact top bar: the mode switch is the exit", () => {
  it("leaves Interact through the mode switch, with no separate Exit, Edit or Annotate button", async () => {
    const onModeChange = vi.fn<(mode: EditorMode) => void>();
    const { host, unmount } = await mount(interactTopBar(onModeChange));

    const labels = Array.from(host.querySelectorAll("[aria-label]")).map(
      (element) => element.getAttribute("aria-label"),
    );
    expect(labels).not.toContain("designEditor.responsiveInteract.exit");
    expect(labels).not.toContain("designEditor.modes.edit");
    expect(
      host.querySelector("button[aria-label='designEditor.modes.annotate']"),
    ).toBeNull();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-design-mode="edit"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onModeChange).toHaveBeenCalledWith("edit");
    await unmount();
  });

  it("has no width or height inputs", async () => {
    const { host, unmount } = await mount(interactTopBar(noop));
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).not.toContain("widthAbbreviation");
    await unmount();
  });

  it("puts device and theme beside the mode switch, routes in the centre and zoom on the right", async () => {
    const { host, unmount } = await mount(interactTopBar(noop));
    const bar = host.querySelector("[data-design-top-bar]")!;
    const switchEl = bar.querySelector("[data-design-mode-switch]")!;
    const device = bar.querySelector("[data-design-interact-device]")!;
    const theme = bar.querySelector("[data-design-interact-theme]")!;
    const center = bar.querySelector("[data-design-top-bar-center]")!;
    const zoom = bar.querySelector("[data-design-interact-zoom]")!;

    expect(switchEl.parentElement?.contains(device)).toBe(true);
    expect(switchEl.parentElement?.contains(theme)).toBe(true);
    expect(
      center.querySelector("[data-design-interact-routes]"),
    ).not.toBeNull();
    expect(center.contains(device)).toBe(false);
    expect(
      switchEl.compareDocumentPosition(device) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      center.compareDocumentPosition(zoom) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await unmount();
  });
});

describe("InteractFloatingBar (minimal UI, no mode switch)", () => {
  it("keeps an explicit Exit and calls it", async () => {
    const onExit = vi.fn();
    const { host, unmount } = await mount(
      <InteractFloatingBar
        devicePicker={<span data-slot="device" />}
        themePicker={<span data-slot="theme" />}
        routeControls={<span data-slot="routes" />}
        onExit={onExit}
      />,
    );
    expect(host.querySelector("[data-slot=device]")).not.toBeNull();
    expect(host.querySelector("[data-slot=theme]")).not.toBeNull();
    expect(host.querySelector("[data-slot=routes]")).not.toBeNull();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          "button[aria-label='designEditor.responsiveInteract.exit']",
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onExit).toHaveBeenCalledTimes(1);
    await unmount();
  });
});

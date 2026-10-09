// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  InteractDevicePicker,
  InteractRouteControls,
  InteractThemePicker,
  InteractZoomReadout,
} from "./InteractControls";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}|${Object.values(options).join("x")}` : key,
}));

const unmounts: Array<() => Promise<void>> = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
});

afterEach(async () => {
  while (unmounts.length) await unmounts.pop()!();
  vi.unstubAllGlobals();
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

async function click(element: Element | null | undefined) {
  await act(async () => {
    element?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function openMenu(trigger: Element | null) {
  await act(async () => {
    trigger?.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  });
}

/** Radix Select opens on ArrowDown and picks on Enter; it ignores synthetic clicks. */
async function openSelect(trigger: Element | null) {
  await act(async () => {
    (trigger as HTMLElement | null)?.focus();
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function chooseSelectOption(option: HTMLElement | undefined) {
  await act(async () => {
    option?.focus();
    option?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("InteractDevicePicker", () => {
  it("names the device preset", async () => {
    const host = await mount(
      <InteractDevicePicker
        deviceName="iPhone 17"
        width={402}
        height={874}
        onChange={vi.fn()}
      />,
    );
    const trigger = host.querySelector("[data-design-interact-device]");
    expect(trigger?.textContent).toContain("iPhone 17");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "designEditor.responsiveInteract.device",
    );
  });

  it("shows a screen that matches no preset read-only as Custom with its size", async () => {
    const host = await mount(
      <InteractDevicePicker
        deviceName="Custom"
        width={1000}
        height={700}
        onChange={vi.fn()}
      />,
    );
    expect(
      host.querySelector("[data-design-interact-device]")?.textContent,
    ).toContain("designEditor.responsiveInteract.deviceCustom|1000x700");
  });
});

describe("InteractThemePicker", () => {
  const menuItems = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[role=menuitemradio]"));

  it("opens to Light and Dark only, with the current one checked, and reports a pick", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractThemePicker
        mode="light"
        canPick
        darkAvailable
        onChange={onChange}
      />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    const items = menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      "designEditor.responsiveInteract.themeLight",
      "designEditor.responsiveInteract.themeDark",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    await click(items[1]);
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("shows the chosen mode on the trigger", async () => {
    const host = await mount(
      <InteractThemePicker
        mode="dark"
        canPick
        darkAvailable
        onChange={vi.fn()}
      />,
    );
    expect(
      host.querySelector("[data-design-interact-theme]")?.textContent,
    ).toContain("themeDark");
  });

  it("marks Dark as unavailable when the design has no dark styles, but still reports the pick", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractThemePicker
        mode="light"
        canPick
        darkAvailable={false}
        onChange={onChange}
      />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    const [light, dark] = menuItems();
    expect(light?.hasAttribute("data-design-theme-unavailable")).toBe(false);
    expect(dark?.hasAttribute("data-design-theme-unavailable")).toBe(true);
    expect(dark?.getAttribute("aria-disabled")).toBeNull();
    await click(dark);
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("does not mark Dark unavailable when the design has dark styles", async () => {
    const host = await mount(
      <InteractThemePicker
        mode="light"
        canPick
        darkAvailable
        onChange={vi.fn()}
      />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    expect(
      document.querySelector("[data-design-theme-unavailable]"),
    ).toBeNull();
  });

  it("disables the whole picker, with its reason, when the page cannot take the override", async () => {
    const host = await mount(
      <InteractThemePicker
        mode="light"
        canPick={false}
        darkAvailable={false}
        onChange={vi.fn()}
      />,
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      "[data-design-interact-theme]",
    );
    expect(trigger?.disabled).toBe(true);
    await openMenu(trigger);
    expect(document.querySelector("[role=menuitemradio]")).toBeNull();
  });
});

describe("InteractRouteControls", () => {
  const routes = [
    { screenId: "home", route: "/home", title: "Screen 1" },
    { screenId: "docs", route: "/docs", title: "Docs" },
  ];

  function renderControls(
    overrides: Partial<Parameters<typeof InteractRouteControls>[0]> = {},
  ) {
    const handlers = {
      onSelect: vi.fn(),
      onBack: vi.fn(),
      onForward: vi.fn(),
      onReload: vi.fn(),
    };
    return mount(
      <InteractRouteControls
        routes={routes}
        activeScreenId="home"
        canGoBack
        canGoForward
        {...handlers}
        {...overrides}
      />,
    ).then((host) => ({ host, ...handlers }));
  }

  const button = (host: HTMLElement, label: string) =>
    host.querySelector<HTMLButtonElement>(
      `button[aria-label='designEditor.responsiveInteract.${label}']`,
    );

  const trigger = (host: HTMLElement) =>
    host.querySelector("[data-design-interact-route]");

  it("names the active page and mutes its route beside it", async () => {
    const { host } = await renderControls({ activeScreenId: "docs" });
    expect(trigger(host)?.textContent).toBe("Docs/docs");
    const route = trigger(host)?.querySelector("[data-design-route-path]");
    expect(route?.textContent).toBe("/docs");
    expect(route?.className).toContain("text-muted-foreground");
    expect(
      trigger(host)?.querySelector("[data-design-route-title]")?.textContent,
    ).toBe("Docs");
  });

  it("selects the first page when no screen is active, not a blank or a bare slash", async () => {
    const { host } = await renderControls({ activeScreenId: null });
    expect(trigger(host)?.textContent).toBe("Screen 1/home");
  });

  it("selects the first page when the active screen is not one of the pages", async () => {
    const { host } = await renderControls({ activeScreenId: "deleted" });
    expect(trigger(host)?.textContent).toBe("Screen 1/home");
  });

  it("works for a one-page design", async () => {
    const { host } = await renderControls({
      routes: [{ screenId: "home", route: "/", title: "Home" }],
      activeScreenId: null,
    });
    expect(trigger(host)?.textContent).toBe("Home/");
  });

  it("shows nothing but the dot for a design with no pages", async () => {
    const { host } = await renderControls({ routes: [], activeScreenId: null });
    expect(trigger(host)?.textContent).toBe("");
    expect(trigger(host)?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("lists every page with its title and route, and checks the current one", async () => {
    const many = [
      { screenId: "home", route: "/home", title: "Screen 1" },
      { screenId: "docs", route: "/docs", title: "Docs" },
      { screenId: "pricing", route: "/pricing", title: "Pricing" },
      { screenId: "blog", route: "/blog/latest", title: "Blog" },
    ];
    const { host, onSelect } = await renderControls({
      routes: many,
      activeScreenId: "pricing",
    });
    await openSelect(trigger(host));
    const items = Array.from(
      document.querySelectorAll<HTMLElement>("[role=option]"),
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Screen 1/home",
      "Docs/docs",
      "Pricing/pricing",
      "Blog/blog/latest",
    ]);
    expect(items.map((item) => item.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    await chooseSelectOption(items[1]);
    expect(onSelect).toHaveBeenCalledWith("docs");
  });

  it("checks the first page in the list when nothing is active", async () => {
    const { host } = await renderControls({ activeScreenId: null });
    await openSelect(trigger(host));
    const items = Array.from(
      document.querySelectorAll<HTMLElement>("[role=option]"),
    );
    expect(items.map((item) => item.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
  });

  it("marks the route with a solid colored dot, not a dashed circle", async () => {
    const { host } = await renderControls();
    const trigger = host.querySelector("[data-design-interact-route]");
    const dot = trigger?.querySelector("[data-design-status-dot]");
    expect(dot).not.toBeNull();
    expect(dot?.className).toContain("rounded-full");
    expect(dot?.className).toContain("bg-emerald-500");
    expect(trigger?.querySelector(".tabler-icon-circle-dashed")).toBeNull();
  });

  it("calls back, forward and reload", async () => {
    const { host, onBack, onForward, onReload } = await renderControls();
    await click(button(host, "back"));
    await click(button(host, "forward"));
    await click(button(host, "reload"));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("disables back and forward when there is nowhere to go, not reload", async () => {
    const { host, onBack, onForward } = await renderControls({
      canGoBack: false,
      canGoForward: false,
    });
    expect(button(host, "back")?.disabled).toBe(true);
    expect(button(host, "forward")?.disabled).toBe(true);
    expect(button(host, "reload")?.disabled).toBe(false);
    await click(button(host, "back"));
    await click(button(host, "forward"));
    expect(onBack).not.toHaveBeenCalled();
    expect(onForward).not.toHaveBeenCalled();
  });

  it("sheds back, forward and reload below sm but keeps the route dropdown", async () => {
    const { host } = await renderControls();
    for (const label of ["back", "forward", "reload"]) {
      const wrapper = button(host, label)?.closest("div");
      expect(wrapper?.classList.contains("hidden")).toBe(true);
      expect(wrapper?.classList.contains("sm:flex")).toBe(true);
    }
    expect(
      host.querySelector("[data-design-interact-route]")?.closest(".hidden"),
    ).toBeNull();
  });
});

describe("InteractZoomReadout", () => {
  it("shows the fit zoom as a reading, not a menu", async () => {
    const host = await mount(<InteractZoomReadout zoom={66.7} />);
    const readout = host.querySelector("[data-design-interact-zoom]");
    expect(readout?.textContent).toBe("67%");
    expect(readout?.tagName).toBe("SPAN");
    expect(host.querySelector("button")).toBeNull();
  });
});

// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  InteractDevicePicker,
  InteractScreenControls,
  InteractThemePicker,
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

  it("opens to Light, Dark and System, with the current one checked, and reports a pick", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractThemePicker mode="light" darkAvailable onChange={onChange} />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    const items = menuItems();
    expect(items.map((item) => item.textContent)).toEqual([
      "designEditor.responsiveInteract.themeLight",
      "designEditor.responsiveInteract.themeDark",
      "designEditor.responsiveInteract.themeSystem",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    await click(items[1]);
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("reports System", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractThemePicker mode="light" darkAvailable onChange={onChange} />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    await click(menuItems()[2]);
    expect(onChange).toHaveBeenCalledWith("system");
  });

  it("shows the chosen mode on the trigger", async () => {
    for (const [mode, label] of [
      ["dark", "themeDark"],
      ["system", "themeSystem"],
    ] as const) {
      const host = await mount(
        <InteractThemePicker mode={mode} darkAvailable onChange={vi.fn()} />,
      );
      expect(
        host.querySelector("[data-design-interact-theme]")?.textContent,
      ).toContain(label);
    }
  });

  it("checks System when System is the mode", async () => {
    const host = await mount(
      <InteractThemePicker mode="system" darkAvailable onChange={vi.fn()} />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    expect(
      menuItems().map((item) => item.getAttribute("aria-checked")),
    ).toEqual(["false", "false", "true"]);
  });

  it("marks Dark, and only Dark, as unavailable when the design has no dark styles, but still reports the pick", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractThemePicker
        mode="light"
        darkAvailable={false}
        onChange={onChange}
      />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    const [light, dark, system] = menuItems();
    expect(light?.hasAttribute("data-design-theme-unavailable")).toBe(false);
    expect(dark?.hasAttribute("data-design-theme-unavailable")).toBe(true);
    expect(system?.hasAttribute("data-design-theme-unavailable")).toBe(false);
    expect(dark?.getAttribute("aria-disabled")).toBeNull();
    await click(dark);
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("does not mark Dark unavailable when the design has dark styles", async () => {
    const host = await mount(
      <InteractThemePicker mode="light" darkAvailable onChange={vi.fn()} />,
    );
    await openMenu(host.querySelector("[data-design-interact-theme]"));
    expect(
      document.querySelector("[data-design-theme-unavailable]"),
    ).toBeNull();
  });

  it("is always a live menu: it has no disabled state to explain", async () => {
    const host = await mount(
      <InteractThemePicker mode="light" darkAvailable onChange={vi.fn()} />,
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      "[data-design-interact-theme]",
    );
    expect(trigger?.disabled).toBe(false);
    expect(
      host.querySelector("[data-design-interact-theme-unavailable]"),
    ).toBeNull();
  });
});

describe("InteractScreenControls", () => {
  const screens = [
    { screenId: "home", title: "Screen 1" },
    { screenId: "docs", title: "Docs" },
  ];

  function renderControls(
    overrides: Partial<Parameters<typeof InteractScreenControls>[0]> = {},
  ) {
    const handlers = {
      onSelect: vi.fn(),
      onBack: vi.fn(),
      onForward: vi.fn(),
      onReload: vi.fn(),
    };
    return mount(
      <InteractScreenControls
        screens={screens}
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

  it("names the active screen, with no route beside it", async () => {
    const { host } = await renderControls({ activeScreenId: "docs" });
    expect(trigger(host)?.textContent).toBe("Docs");
    expect(trigger(host)?.textContent).not.toContain("/");
    expect(trigger(host)?.querySelector("[data-design-route-path]")).toBeNull();
    expect(
      trigger(host)?.querySelector("[data-design-screen-title]")?.textContent,
    ).toBe("Docs");
  });

  it("calls itself a screen picker, not a route picker", async () => {
    const { host } = await renderControls();
    expect(trigger(host)?.getAttribute("aria-label")).toBe(
      "designEditor.responsiveInteract.screen",
    );
    expect(host.innerHTML).not.toContain("responsiveInteract.route");
  });

  it("selects the first screen when none is active, not a blank or a bare slash", async () => {
    const { host } = await renderControls({ activeScreenId: null });
    expect(trigger(host)?.textContent).toBe("Screen 1");
  });

  it("selects the first screen when the active one is not a screen of the design", async () => {
    const { host } = await renderControls({ activeScreenId: "deleted" });
    expect(trigger(host)?.textContent).toBe("Screen 1");
  });

  it("works for a one-screen design", async () => {
    const { host } = await renderControls({
      screens: [{ screenId: "home", title: "Home" }],
      activeScreenId: null,
    });
    expect(trigger(host)?.textContent).toBe("Home");
  });

  it("shows nothing but the dot for a design with no screens", async () => {
    const { host } = await renderControls({
      screens: [],
      activeScreenId: null,
    });
    expect(trigger(host)?.textContent).toBe("");
    expect(trigger(host)?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("lists every screen by name only, and checks the current one", async () => {
    const many = [
      { screenId: "home", title: "Screen 1" },
      { screenId: "docs", title: "Docs" },
      { screenId: "pricing", title: "Pricing" },
      { screenId: "blog", title: "Blog" },
    ];
    const { host, onSelect } = await renderControls({
      screens: many,
      activeScreenId: "pricing",
    });
    await openSelect(trigger(host));
    const items = Array.from(
      document.querySelectorAll<HTMLElement>("[role=option]"),
    );
    expect(items.map((item) => item.textContent)).toEqual([
      "Screen 1",
      "Docs",
      "Pricing",
      "Blog",
    ]);
    expect(document.querySelector("[data-design-route-path]")).toBeNull();
    expect(items.map((item) => item.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    await chooseSelectOption(items[1]);
    expect(onSelect).toHaveBeenCalledWith("docs");
  });

  it("checks the first screen in the list when nothing is active", async () => {
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

  it("marks the screen with a solid colored dot, not a dashed circle", async () => {
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

  it("sheds back, forward and reload below sm but keeps the screen dropdown", async () => {
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

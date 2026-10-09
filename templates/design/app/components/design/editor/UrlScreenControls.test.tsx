// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { UrlScreenControls } from "./UrlScreenControls";

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

const SCREEN = {
  title: "Pricing page",
  route: "/pricing",
  url: "http://localhost:3000/pricing",
  openUrl: "http://localhost:3000/pricing",
};

describe("UrlScreenControls", () => {
  it("reads out the screen's route and gives the full URL on hover", async () => {
    const host = await mount(
      <UrlScreenControls screen={SCREEN} onReload={vi.fn()} />,
    );
    const route = host.querySelector("[data-design-url-screen-route]");
    expect(route?.textContent).toBe("Pricing page/pricing");
    expect(route?.getAttribute("title")).toBe("http://localhost:3000/pricing");
  });

  it("names the page and mutes its route beside it", async () => {
    const host = await mount(
      <UrlScreenControls screen={SCREEN} onReload={vi.fn()} />,
    );
    expect(host.querySelector("[data-design-route-title]")?.textContent).toBe(
      "Pricing page",
    );
    const route = host.querySelector("[data-design-route-path]");
    expect(route?.textContent).toBe("/pricing");
    expect(route?.className).toContain("text-muted-foreground");
  });

  it("leads the route with the same status dot the Interact route uses", async () => {
    const host = await mount(
      <UrlScreenControls screen={SCREEN} onReload={vi.fn()} />,
    );
    const dot = host.querySelector(
      "[data-design-url-screen-route] [data-design-status-dot]",
    );
    expect(dot?.className).toContain("rounded-full");
    expect(dot?.className).toContain("bg-emerald-500");
  });

  it("is not a picker: the route is a reading, so nothing in it can be activated", async () => {
    const host = await mount(
      <UrlScreenControls screen={SCREEN} onReload={vi.fn()} />,
    );
    expect(
      host.querySelector("[data-design-url-screen-route]")?.closest("button"),
    ).toBeNull();
    expect(host.querySelector("[role=combobox]")).toBeNull();
  });

  it("reloads the screen", async () => {
    const onReload = vi.fn();
    const host = await mount(
      <UrlScreenControls screen={SCREEN} onReload={onReload} />,
    );
    const reload = host.querySelector<HTMLElement>(
      'button[aria-label="designEditor.responsiveInteract.reload"]',
    );
    expect(reload).not.toBeNull();
    await act(async () => reload!.click());
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("opens the page in a new tab that cannot reach back into the editor", async () => {
    const host = await mount(
      <UrlScreenControls screen={SCREEN} onReload={vi.fn()} />,
    );
    const open = host.querySelector<HTMLAnchorElement>(
      "a[data-design-url-screen-open]",
    );
    expect(open?.getAttribute("href")).toBe("http://localhost:3000/pricing");
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(open?.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    expect(open?.getAttribute("aria-label")).toBe(
      "designEditor.topBar.openInBrowser",
    );
  });

  it("offers a disabled button, not a link, when the URL has nowhere to open", async () => {
    const host = await mount(
      <UrlScreenControls
        screen={{ ...SCREEN, openUrl: null }}
        onReload={vi.fn()}
      />,
    );
    expect(host.querySelector("a[data-design-url-screen-open]")).toBeNull();
    const open = host.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.topBar.openInBrowser"]',
    );
    expect(open?.disabled).toBe(true);
  });
});

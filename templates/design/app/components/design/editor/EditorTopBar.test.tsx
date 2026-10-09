// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type { EditorMode } from "@/pages/design-editor/types";

import { EditorTopBar } from "./EditorTopBar";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

async function renderBar(
  props: Partial<Parameters<typeof EditorTopBar>[0]> = {},
) {
  const onModeChange = vi.fn<(mode: EditorMode) => void>();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <EditorTopBar
        mode="edit"
        onModeChange={onModeChange}
        leftInset={344}
        narrowLeftInset={64}
        {...props}
      />,
    );
  });
  return {
    host,
    onModeChange,
    unmount: () => act(async () => root.unmount()).then(() => host.remove()),
  };
}

describe("EditorTopBar", () => {
  it("lists Interact, Design and Annotate and marks the current mode", async () => {
    const { host, unmount } = await renderBar({ mode: "edit" });
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-design-mode]"),
    );
    expect(buttons.map((button) => button.dataset.designMode)).toEqual([
      "interact",
      "edit",
      "annotate",
    ]);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "designEditor.modes.interact",
      "designEditor.topBar.modeDesign",
      "designEditor.modes.annotate",
    ]);
    expect(
      buttons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["false", "true", "false"]);
    await unmount();
  });

  it("reports the internal mode value when a segment is clicked", async () => {
    const { host, onModeChange, unmount } = await renderBar({
      mode: "interact",
    });
    const design = host.querySelector<HTMLButtonElement>(
      '[data-design-mode="edit"]',
    );
    await act(async () => {
      design?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onModeChange).toHaveBeenCalledWith("edit");
    await unmount();
  });

  it("only offers the modes it is given", async () => {
    const { host, unmount } = await renderBar({ modes: ["interact", "edit"] });
    expect(
      Array.from(host.querySelectorAll<HTMLElement>("[data-design-mode]")).map(
        (button) => button.dataset.designMode,
      ),
    ).toEqual(["interact", "edit"]);
    await unmount();
  });

  it("drops the switch entirely when no modes are offered", async () => {
    const { host, unmount } = await renderBar({ modes: [] });
    expect(host.querySelector("[data-design-mode-switch]")).toBeNull();
    expect(host.querySelector("[data-design-top-bar]")).not.toBeNull();
    await unmount();
  });

  it("is one 48px row on a three-column grid that sheds zoom and presence on narrow screens", async () => {
    const { host, unmount } = await renderBar({
      zoomControl: <button data-slot="zoom">67%</button>,
      presence: <span data-slot="presence" />,
    });
    const bar = host.querySelector<HTMLElement>("[data-design-top-bar]");
    expect(bar?.classList.contains("h-12")).toBe(true);
    expect(
      bar?.classList.contains(
        "grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)]",
      ),
    ).toBe(true);
    expect(bar?.style.getPropertyValue("--top-bar-left")).toBe("344px");
    expect(bar?.style.getPropertyValue("--top-bar-left-narrow")).toBe("64px");
    expect(bar?.classList.contains("md:left-[var(--top-bar-left)]")).toBe(true);
    for (const [slot, breakpoint] of [
      ["zoom", "sm:flex"],
      ["presence", "lg:flex"],
    ]) {
      const wrapper = bar?.querySelector(`[data-slot=${slot}]`)?.parentElement;
      expect(wrapper?.classList.contains("hidden")).toBe(true);
      expect(wrapper?.classList.contains(breakpoint!)).toBe(true);
    }
    await unmount();
  });

  it("keeps the widget title, zoom and Share beside a compact mode menu", async () => {
    const { host, unmount } = await renderBar({
      widgetLayout: true,
      center: <button data-slot="title">Product Launch Demo</button>,
      zoomControl: <button data-slot="zoom">67%</button>,
      presence: <span data-slot="presence" />,
      actions: <button data-slot="share">Share</button>,
    });
    const bar = host.querySelector<HTMLElement>("[data-design-top-bar]");
    expect(
      bar?.classList.contains(
        "grid-cols-[max-content_minmax(0,1fr)_max-content]",
      ),
    ).toBe(true);
    expect(
      host.querySelector("[data-design-widget-mode-switch]"),
    ).not.toBeNull();
    expect(
      host.querySelector("[data-design-widget-mode-trigger]")?.textContent,
    ).toContain("designEditor.topBar.modeDesign");
    expect(
      bar
        ?.querySelector("[data-slot=zoom]")
        ?.parentElement?.classList.contains("flex"),
    ).toBe(true);
    expect(host.querySelector("[data-slot=title]")).not.toBeNull();
    expect(host.querySelector("[data-slot=share]")).not.toBeNull();
    expect(host.querySelector("[data-slot=presence]")).toBeNull();
    await unmount();
  });

  it("spans the inspector width with presence and actions only when it is docked", async () => {
    const docked = await renderBar({
      inspectorWidth: 240,
      actions: <button data-slot="share">Share</button>,
    });
    const zone = docked.host.querySelector<HTMLElement>(
      "[data-design-top-bar-inspector-zone]",
    );
    expect(
      docked.host
        .querySelector<HTMLElement>("[data-design-top-bar]")
        ?.style.getPropertyValue("--top-bar-inspector"),
    ).toBe("240px");
    expect(
      zone?.classList.contains("lg:min-w-[calc(var(--top-bar-inspector)-8px)]"),
    ).toBe(true);
    await docked.unmount();

    const hidden = await renderBar({});
    expect(
      hidden.host
        .querySelector("[data-design-top-bar-inspector-zone]")
        ?.classList.contains("lg:min-w-[calc(var(--top-bar-inspector)-8px)]"),
    ).toBe(false);
    await hidden.unmount();
  });

  it("renders the right-hand slots and an empty centre zone", async () => {
    const { host, unmount } = await renderBar({
      zoomControl: <button data-slot="zoom">67%</button>,
      presence: <span data-slot="presence" />,
      actions: <button data-slot="share">Share</button>,
    });
    const bar = host.querySelector("[data-design-top-bar]");
    expect(bar?.querySelector("[data-slot=zoom]")).not.toBeNull();
    expect(bar?.querySelector("[data-slot=presence]")).not.toBeNull();
    expect(bar?.querySelector("[data-slot=share]")).not.toBeNull();
    expect(
      host.querySelector("[data-design-top-bar-center]")?.childElementCount,
    ).toBe(0);
    await unmount();
  });
});

// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { InteractZoomControl } from "./InteractZoomControl";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
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

async function choose(option: HTMLElement | undefined) {
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

const options = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[role=option]"));

describe("InteractZoomControl", () => {
  it("reads the scale the preview is at, including the one Fit resolved to", async () => {
    const host = await mount(
      <InteractZoomControl zoom={66.7} choice="fit" onChange={vi.fn()} />,
    );
    const trigger = host.querySelector("[data-design-interact-zoom]");
    expect(trigger?.textContent).toBe("67%");
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("aria-label")).toBe(
      "designEditor.responsiveInteract.zoom",
    );
  });

  it("offers Fit and the locked percentages, with the current choice marked", async () => {
    const host = await mount(
      <InteractZoomControl zoom={125} choice={125} onChange={vi.fn()} />,
    );
    await openSelect(host.querySelector("[data-design-interact-zoom]"));

    expect(options().map((option) => option.textContent)).toEqual([
      "designEditor.responsiveInteract.zoomFitOption",
      "50%",
      "75%",
      "100%",
      "125%",
      "150%",
      "200%",
    ]);
    expect(
      options().find(
        (option) => option.getAttribute("aria-selected") === "true",
      )?.textContent,
    ).toBe("125%");
  });

  it("reports a percentage as a number and Fit as fit", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractZoomControl zoom={67} choice="fit" onChange={onChange} />,
    );

    await openSelect(host.querySelector("[data-design-interact-zoom]"));
    await choose(options().find((option) => option.textContent === "150%"));
    expect(onChange).toHaveBeenLastCalledWith(150);

    await openSelect(host.querySelector("[data-design-interact-zoom]"));
    await choose(options().find((option) => option.textContent === "50%"));
    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it("goes back to Fit from a percentage", async () => {
    const onChange = vi.fn();
    const host = await mount(
      <InteractZoomControl zoom={100} choice={100} onChange={onChange} />,
    );

    await openSelect(host.querySelector("[data-design-interact-zoom]"));
    await choose(options()[0]);
    expect(onChange).toHaveBeenCalledWith("fit");
  });
});

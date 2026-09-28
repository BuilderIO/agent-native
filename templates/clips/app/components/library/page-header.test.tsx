// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { PageBreadcrumb, type PageBreadcrumbItem } from "./page-header";

const ITEMS: PageBreadcrumbItem[] = [
  { label: "Library", to: "/library" },
  { label: "ProjectA", to: "/library/folder/1" },
  { label: "Subfolder1", to: "/library/folder/2" },
  { label: "Subfolder2", to: "/library/folder/3" },
  { label: "Subfolder3", to: "/library/folder/4" },
  { label: "CurrentDoc" },
];

function stubMeasurements(clientWidth: number) {
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  const originalScrollWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollWidth",
  );

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent?.length ?? 0;
    },
  });

  return () => {
    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        originalClientWidth,
      );
    }
    if (originalScrollWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollWidth",
        originalScrollWidth,
      );
    }
  };
}

class NoopResizeObserver {
  observe() {}
  disconnect() {}
}

let restoreMeasurements: (() => void) | undefined;
let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  root?.unmount();
  container?.remove();
  restoreMeasurements?.();
  root = undefined;
  container = undefined;
  restoreMeasurements = undefined;
});

async function renderBreadcrumb(
  clientWidth: number,
  items: PageBreadcrumbItem[] = ITEMS,
) {
  restoreMeasurements = stubMeasurements(clientWidth);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <MemoryRouter>
        <TooltipProvider>
          <PageBreadcrumb items={items} />
        </TooltipProvider>
      </MemoryRouter>,
    );
  });

  return container;
}

describe("PageBreadcrumb overflow collapsing", () => {
  it("keeps the full path visible when it fits the available width", async () => {
    const el = await renderBreadcrumb(1000);

    for (const item of ITEMS) {
      expect(el.textContent).toContain(item.label);
    }
  });

  it("collapses from the left, keeping the tail nearest the current page", async () => {
    const el = await renderBreadcrumb(45);

    expect(el.textContent).toContain("Library");
    expect(el.textContent).toContain("CurrentDoc");
    expect(el.textContent).toContain("Subfolder2");
    expect(el.textContent).toContain("Subfolder3");
    expect(el.textContent).not.toContain("ProjectA");
    expect(el.textContent).not.toContain("Subfolder1");
  });

  it("collapses down to root + … + parent + current when space is very tight", async () => {
    const el = await renderBreadcrumb(10);

    expect(el.textContent).toContain("Library");
    expect(el.textContent).toContain("Subfolder3");
    expect(el.textContent).toContain("CurrentDoc");
    expect(el.textContent).not.toContain("ProjectA");
    expect(el.textContent).not.toContain("Subfolder1");
    expect(el.textContent).not.toContain("Subfolder2");
  });
});

describe("PageBreadcrumb", () => {
  it("renders no back-arrow icon button alongside the breadcrumb trail", async () => {
    const el = await renderBreadcrumb(1000, [
      { label: "Library", to: "/library" },
      { label: "CurrentDoc" },
    ]);

    expect(el.querySelector("a[aria-label]")).toBeNull();
  });
});

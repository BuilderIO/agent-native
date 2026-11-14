// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";
import type { ElementInfo } from "./types";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function layer(overrides: Partial<ElementInfo>): ElementInfo {
  return {
    tagName: "DIV",
    classes: [],
    computedStyles: {
      position: "absolute",
      left: "40px",
      top: "60px",
      width: "120px",
      height: "80px",
      backgroundColor: "rgb(217, 217, 217)",
    },
    boundingRect: { x: 40, y: 60, width: 120, height: 80 },
    parentBoundingRect: { x: 0, y: 0, width: 800, height: 600 },
    isFlexChild: false,
    isFlexContainer: false,
    childElementCount: 0,
    sourceId: "layer-1",
    ...overrides,
  };
}

const RECT = layer({ primitiveKind: "rectangle" });
const TEXT = layer({
  tagName: "P",
  primitiveKind: "text",
  hasOwnText: true,
  textContent: "Hello",
  computedStyles: {
    position: "absolute",
    left: "40px",
    top: "60px",
    width: "74.5px",
    height: "19.2px",
    color: "rgb(0, 0, 0)",
    fontSize: "16px",
  },
  boundingRect: { x: 40, y: 60, width: 74.5, height: 19.2 },
});
const LINE = layer({
  tagName: "svg",
  primitiveKind: "line",
  htmlContent: '<path d="M 0 40 L 300 0" fill="none" stroke="#000000"></path>',
  computedStyles: {
    position: "absolute",
    left: "40px",
    top: "60px",
    width: "300px",
    height: "40px",
  },
  boundingRect: { x: 40, y: 60, width: 300, height: 40 },
});
const GROUP = layer({ isGroup: true, childElementCount: 2 });

function renderLayer(element: ElementInfo, selectedElements?: ElementInfo[]) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <EditPanel
          selectedElement={element}
          selectedElements={selectedElements}
          viewMode="overview"
          mode="edit"
          onStyleChange={vi.fn()}
          onStylesChange={vi.fn()}
          onExport={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  );
}

function sectionTitles(): string[] {
  return Array.from(
    container.querySelectorAll("[data-design-inspector-section-header] h3"),
  ).map((heading) => heading.textContent ?? "");
}

function section(title: string): HTMLElement | null {
  return (
    container
      .querySelector(`h3[aria-label="${title}"]`)
      ?.closest<HTMLElement>("section") ?? null
  );
}

function input(label: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
}

function headerTitle(): string {
  return (
    container.querySelector("[data-design-inspector-header]")?.textContent ?? ""
  );
}

describe("inspector header", () => {
  it("names layers by their layer type", () => {
    renderLayer(RECT);
    expect(headerTitle()).toContain("Rectangle");
    renderLayer(LINE);
    expect(headerTitle()).toContain("Line");
  });

  it("shows no route on a static screen", () => {
    act(() =>
      root.render(
        <EditPanel
          selectedElement={null}
          selectedScreenGeometry={{
            id: "screen-1",
            title: "Home",
            x: 0,
            y: 0,
            width: 800,
            height: 600,
          }}
          selectedScreenRoute="/"
          selectedScreenSource={{ sourceType: "static" }}
          viewMode="overview"
          mode="edit"
          onStyleChange={vi.fn()}
        />,
      ),
    );
    expect(headerTitle()).toBe("Home");
  });

  it("shows the route of a URL screen", () => {
    act(() =>
      root.render(
        <EditPanel
          selectedElement={null}
          selectedScreenGeometry={{
            id: "screen-1",
            title: "Pricing",
            x: 0,
            y: 0,
            width: 800,
            height: 600,
          }}
          selectedScreenRoute="/pricing"
          selectedScreenSource={{
            sourceType: "url",
            url: "http://localhost:3000/pricing",
          }}
          viewMode="overview"
          mode="edit"
          onStyleChange={vi.fn()}
        />,
      ),
    );
    expect(headerTitle()).toContain("/pricing");
  });
});

describe("sections that apply to the layer", () => {
  it("gives a leaf rectangle Layout sizing without Auto layout or Margin", () => {
    renderLayer(RECT);
    const titles = sectionTitles();
    expect(titles).toContain("editPanel.sections.layout");
    expect(titles).not.toContain("editPanel.sections.autoLayout");
    expect(
      container.querySelector('input[aria-label^="editPanel.labels.margin"]'),
    ).toBeNull();
  });

  it("keeps the Interaction state picker out of the top slot for a layer with no states", () => {
    renderLayer(RECT);
    const picker = container.querySelector(
      'button[aria-label="editPanel.interactionStates.selectorLabel"]',
    );
    const position = container.querySelector(
      'h3[aria-label="editPanel.sections.positionLayout"]',
    );
    const layout = container.querySelector(
      'h3[aria-label="editPanel.sections.layout"]',
    );
    expect(picker).not.toBeNull();
    expect(position).not.toBeNull();
    expect(layout).not.toBeNull();
    expect(
      position!.compareDocumentPosition(picker!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      layout!.compareDocumentPosition(picker!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides Corner radius on text without a box", () => {
    renderLayer(TEXT);
    expect(input("editPanel.labels.cornerRadius")).toBeNull();
    expect(input("editPanel.labels.opacity")).not.toBeNull();
  });

  it("shows a line's Length and Rotation, with no Fill or Corner radius", () => {
    renderLayer(LINE);
    expect(sectionTitles()).not.toContain("editPanel.sections.fill");
    expect(input("editPanel.labels.cornerRadius")).toBeNull();
    expect(input("W size in pixels")).toBeNull();
    expect(input("editPanel.labels.length")?.value).toBe("303");
    expect(input("editPanel.labels.rotation")?.value).toBe("7.6°");
  });

  it("gives a group no Fill, Stroke, or Corner radius", () => {
    renderLayer(GROUP);
    expect(headerTitle()).toContain("Group");
    expect(sectionTitles()).not.toContain("editPanel.sections.fill");
    expect(sectionTitles()).not.toContain("editPanel.sections.stroke");
    expect(input("editPanel.labels.cornerRadius")).toBeNull();
    expect(input("editPanel.labels.opacity")).not.toBeNull();
  });

  it("keeps Stroke and Corner radius for several selected boxes", () => {
    renderLayer(RECT, [
      RECT,
      layer({ primitiveKind: "rectangle", sourceId: "layer-2" }),
    ]);
    expect(sectionTitles()).toContain("editPanel.sections.stroke");
    expect(input("editPanel.labels.cornerRadius")).not.toBeNull();
  });
});

describe("no dead or duplicate chrome", () => {
  it("drops unbuilt Styles and stroke controls", () => {
    renderLayer(
      layer({
        computedStyles: {
          ...RECT.computedStyles,
          borderWidth: "1px",
          borderStyle: "solid",
          borderColor: "rgb(0, 0, 0)",
        },
        primitiveKind: "rectangle",
      }),
    );
    expect(
      container.querySelector(
        '[aria-label="editPanel.labels.stylesComingSoon"]',
      ),
    ).toBeNull();
    expect(container.innerHTML).not.toContain("Coming soon");
  });

  it("lists Effects types as text-only menu items", () => {
    renderLayer(RECT);
    const add = container.querySelector<HTMLButtonElement>(
      'button[aria-label="editPanel.labels.addEffect"]',
    );
    expect(add).not.toBeNull();
    act(() => {
      add!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toContain(
      "editPanel.labels.dropShadow",
    );
    expect(items.some((item) => item.querySelector("svg"))).toBe(false);
  });

  it("does not repeat the Export title inside the Export section", () => {
    renderLayer(RECT);
    const exportSection = section("editPanel.sections.export");
    expect(exportSection).not.toBeNull();
    const labels = Array.from(
      exportSection!.querySelectorAll(".design-sidebar-field-label"),
    ).map((node) => node.textContent);
    expect(labels).not.toContain("Export");
    expect(
      exportSection!.querySelector(
        '[data-design-inspector-section-header] button[aria-label="Add export"]',
      ),
    ).not.toBeNull();
  });
});

describe("bare-number values", () => {
  it("shows pixel fields as bare whole numbers and rotation in degrees", () => {
    renderLayer(TEXT);
    expect(input("X-position")?.value).toBe("40");
    expect(input("editPanel.labels.rotation")?.value).toBe("0°");
    expect(input("W size in pixels")?.value ?? headerTitle()).not.toContain(
      ".",
    );
  });
});

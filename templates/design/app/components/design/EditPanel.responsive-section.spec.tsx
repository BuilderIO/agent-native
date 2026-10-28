// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";
import type { ElementInfo } from "./types";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
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

const element: ElementInfo = {
  tagName: "DIV",
  classes: [],
  computedStyles: { backgroundColor: "#dadada" },
  boundingRect: { x: 0, y: 0, width: 100, height: 100 },
  isFlexChild: false,
  isFlexContainer: false,
};

function sectionTitles(): string[] {
  return Array.from(
    container.querySelectorAll("[data-design-inspector-section-header] h3"),
  ).map((heading) => heading.textContent ?? "");
}

it("puts the breakpoint control in a Responsive section between Effects and Export for an element", () => {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <EditPanel
          selectedElement={element}
          viewMode="overview"
          mode="edit"
          onStyleChange={vi.fn()}
          onExport={vi.fn()}
          screenBreakpointControls={<div data-testid="breakpoint-control" />}
        />
      </QueryClientProvider>,
    ),
  );

  const titles = sectionTitles();
  const effects = titles.indexOf("editPanel.sections.effects");
  const responsive = titles.indexOf("editPanel.sections.responsive");
  const exportSection = titles.indexOf("editPanel.sections.export");
  expect(effects).toBeGreaterThan(-1);
  expect(responsive).toBeGreaterThan(effects);
  expect(exportSection).toBeGreaterThan(responsive);

  const section = container
    .querySelector('h3[aria-label="editPanel.sections.responsive"]')
    ?.closest("section");
  expect(
    section?.querySelector('[data-testid="breakpoint-control"]'),
  ).not.toBeNull();
});

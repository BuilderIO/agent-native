// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { EditPanel } from "./EditPanel";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let styles: HTMLStyleElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  styles = document.createElement("style");
  styles.textContent = readFileSync(
    path.resolve(__dirname, "../../global.css"),
    "utf8",
  );
  document.head.append(styles);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  styles.remove();
  vi.unstubAllGlobals();
});

it("draws one stroke between the screen header and the section under it", () => {
  act(() =>
    root.render(
      <EditPanel
        selectedElement={null}
        selectedScreenGeometry={{
          id: "screen-1",
          title: "Pricing",
          x: 0,
          y: 0,
          width: 1440,
          height: 900,
        }}
        selectedScreenRoute="/pricing"
        viewMode="overview"
        mode="edit"
        onStyleChange={vi.fn()}
        readOnly={false}
      />,
    ),
  );

  const header = container.querySelector<HTMLElement>(
    "[data-design-inspector-header]",
  )!;
  expect(header.textContent).toContain("Pricing");
  expect(header.textContent).toContain("/pricing");

  const sections = Array.from(
    container.querySelectorAll<HTMLElement>(".design-sidebar-section"),
  );
  expect(sections.length).toBeGreaterThan(1);
  expect(header.nextElementSibling).toBe(sections[0]);
  expect(getComputedStyle(sections[0]).boxShadow).toBe("none");
  expect(getComputedStyle(sections[1]).boxShadow).not.toBe("none");
});

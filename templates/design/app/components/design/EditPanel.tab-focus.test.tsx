// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { EditPanel } from "./EditPanel";

let container: HTMLDivElement;
let root: Root;

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

function renderPageInspector() {
  act(() =>
    root.render(
      <TooltipProvider>
        <EditPanel
          selectedElement={null}
          pageStyles={{ backgroundColor: "#ffffff", fontSize: "16px" }}
          viewMode="single"
          mode="edit"
          onStyleChange={() => {}}
          onStylesChange={() => {}}
        />
      </TooltipProvider>,
    ),
  );
}

function inspectorScroll(): HTMLElement {
  const scroll = container.querySelector<HTMLElement>(
    ".design-inspector-scroll",
  );
  if (!scroll) throw new Error("The inspector scroll region is missing");
  return scroll;
}

function openBackgroundPicker() {
  const pageSection = Array.from(
    container.querySelectorAll<HTMLElement>("[data-design-inspector-section]"),
  ).find(
    (section) =>
      section.querySelector("h3[aria-label='editPanel.sections.page']") !==
      null,
  );
  const trigger = pageSection?.querySelector<HTMLButtonElement>(
    'button[aria-label="Open color picker"]',
  );
  if (!trigger) throw new Error("Page background color picker is missing");
  act(() => trigger.click());
  const image = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Image"]',
  );
  if (!image) throw new Error("The picker's Image tab is missing");
  act(() => image.click());
  const field = document.querySelector<HTMLInputElement>(
    'input[aria-label="Image URL"]',
  );
  if (!field) throw new Error("The picker's Image URL field is missing");
  return field;
}

function pressTab(target: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function inspectorFocusables(): HTMLElement[] {
  return Array.from(
    inspectorScroll().querySelectorAll<HTMLElement>(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.tabIndex !== -1 &&
      !el.closest('[aria-hidden="true"]'),
  );
}

describe("inspector Tab handling", () => {
  it("moves focus between inspector controls on Tab", () => {
    renderPageInspector();
    const [first, second] = inspectorFocusables();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    act(() => first.focus());
    expect(document.activeElement).toBe(first);

    const event = pressTab(first);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(second);
  });

  it("leaves Tab inside a portaled color picker to the picker", () => {
    renderPageInspector();
    const field = openBackgroundPicker();
    expect(inspectorScroll().contains(field)).toBe(false);
    act(() => field.focus());
    expect(document.activeElement).toBe(field);

    const event = pressTab(field);

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field);
  });
});

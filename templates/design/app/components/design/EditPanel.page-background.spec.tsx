// @vitest-environment happy-dom

import { act, useState } from "react";
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
import { setBodyInlineStyles } from "@/pages/design-editor/html-layer-positioning";

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

function DocumentInspector({
  onStylesChange,
  preserveGradient = false,
}: {
  onStylesChange: (styles: Record<string, string>) => void;
  preserveGradient?: boolean;
}) {
  const [pageStyles, setPageStyles] = useState({
    backgroundColor: "#ffffff",
    backgroundImage: preserveGradient
      ? "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)"
      : "",
    backgroundPosition: preserveGradient ? "center" : "",
    backgroundRepeat: preserveGradient ? "no-repeat" : "",
    backgroundSize: preserveGradient ? "cover" : "",
    fontSize: "16px",
  });
  return (
    <TooltipProvider>
      <EditPanel
        selectedElement={null}
        pageStyles={pageStyles}
        viewMode="single"
        mode="edit"
        onStyleChange={(property, value) =>
          setPageStyles((current) => ({ ...current, [property]: value }))
        }
        onStylesChange={(styles) => {
          onStylesChange(styles);
          setPageStyles((current) => ({ ...current, ...styles }));
        }}
      />
    </TooltipProvider>
  );
}

function openBackgroundPicker(): HTMLButtonElement {
  const pageSection = Array.from(
    container.querySelectorAll<HTMLElement>("[data-design-inspector-section]"),
  ).find(
    (section) =>
      section.querySelector("h3[aria-label='editPanel.sections.page']") !==
      null,
  );
  expect(pageSection).not.toBeUndefined();
  const trigger = pageSection?.querySelector<HTMLButtonElement>(
    'button[aria-label="Open color picker"]',
  );
  if (!trigger) throw new Error("Page background color picker is missing");
  act(() => trigger.click());
  return trigger;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("HTMLInputElement value setter is missing");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function persistedBodyMarkup(styles: Record<string, string>) {
  const html = setBodyInlineStyles(
    "<!doctype html><html><body></body></html>",
    styles,
  );
  if (!html) throw new Error("Page background styles were not persisted");
  return html;
}

describe("document page background inspector", () => {
  it("renders and commits gradient changes in single-screen edit mode", () => {
    const onStylesChange = vi.fn();
    act(() =>
      root.render(<DocumentInspector onStylesChange={onStylesChange} />),
    );

    openBackgroundPicker();
    const linear = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Gradient"]',
    );
    expect(linear).not.toBeNull();
    act(() => linear!.click());

    const latestChange =
      onStylesChange.mock.calls[onStylesChange.mock.calls.length - 1];
    const patch = latestChange?.[0];
    expect(patch?.backgroundImage).toContain("linear-gradient(");
    expect(persistedBodyMarkup(patch)).toContain(
      "background-image: linear-gradient(",
    );
  });

  it("applies the image URL and tile fit through page background styles", () => {
    const onStylesChange = vi.fn();
    act(() =>
      root.render(
        <DocumentInspector onStylesChange={onStylesChange} preserveGradient />,
      ),
    );

    openBackgroundPicker();
    const image = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Image"]',
    );
    expect(image).not.toBeNull();
    act(() => image!.click());

    const url = document.querySelector<HTMLInputElement>(
      'input[aria-label="Image URL"]',
    );
    expect(url).not.toBeNull();
    act(() => {
      setInputValue(url!, "/icon-180.svg");
      url!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const fill = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Fill"]',
    );
    expect(fill).not.toBeNull();
    act(() => fill!.click());
    const tile = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === "Tile");
    expect(tile).not.toBeUndefined();
    act(() => tile!.click());

    const latestChange =
      onStylesChange.mock.calls[onStylesChange.mock.calls.length - 1];
    const patch = latestChange?.[0];
    expect(patch).toMatchObject({
      backgroundRepeat: "repeat, no-repeat",
      backgroundSize: "auto, cover",
      backgroundPosition: "top left, center",
    });
    expect(patch?.backgroundImage).toContain("/icon-180.svg");
    expect(patch?.backgroundImage).toContain("linear-gradient(");
    const persisted = persistedBodyMarkup(patch);
    expect(persisted).toContain(
      "background-image: url(&quot;/icon-180.svg&quot;) /* agent-native-image-fit:tile */, linear-gradient(",
    );
    expect(persisted).toContain("background-repeat: repeat, no-repeat");
    expect(persisted).toContain("background-position: top left, center");
  });
});

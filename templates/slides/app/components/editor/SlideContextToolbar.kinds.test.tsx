// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideStyleSnapshot } from "./slide-style";
import { SlideContextToolbar } from "./SlideContextToolbar";

function snapshot(
  overrides: Partial<SlideStyleSnapshot> = {},
): SlideStyleSnapshot {
  return {
    selector: '[data-slide-object-id="object-a"]',
    label: "Object",
    tagName: "DIV",
    textPreview: "",
    isText: false,
    isImage: false,
    isAbsolute: true,
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    rotation: 0,
    slideWidth: 1280,
    slideHeight: 720,
    color: "#ffffff",
    fontFamily: "Inter, sans-serif",
    backgroundColor: "#ff0000",
    fontSize: 24,
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "none",
    listKind: null,
    lineHeight: 1.2,
    textAlign: "left",
    opacity: 100,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "#000000",
    paddingX: 0,
    paddingY: 0,
    zIndex: 1,
    ...overrides,
  };
}

function renderToolbar(
  props: Partial<ComponentProps<typeof SlideContextToolbar>>,
) {
  render(
    <TooltipProvider>
      <SlideContextToolbar
        snapshot={null}
        background="#000000"
        onChange={vi.fn()}
        onBackgroundChange={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("contextual toolbar kinds", () => {
  afterEach(cleanup);

  it("shows the insert cluster and no agent button when nothing is selected", () => {
    renderToolbar({ leading: <button type="button">Insert</button> });
    expect(screen.getByRole("button", { name: "Insert" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Edit with agent" }),
    ).toBeNull();
  });

  it("hides the insert cluster while an object is selected", () => {
    renderToolbar({
      snapshot: snapshot(),
      hasSelectedElement: true,
      leading: <button type="button">Insert</button>,
    });
    expect(screen.queryByRole("button", { name: "Insert" })).toBeNull();
  });

  it("offers text quick picks without opening the agent panel", async () => {
    const onOpenAgent = vi.fn();
    const onAgentQuickPick = vi.fn();
    renderToolbar({
      snapshot: snapshot({ isText: true, tagName: "H2" }),
      onOpenAgent,
      onAgentQuickPick,
    });
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit with agent" }), {
      key: "Enter",
    });
    expect(onOpenAgent).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Polish" }));
    expect(onAgentQuickPick).toHaveBeenCalledWith("polish");
  });

  it("toggles bold from the weight", () => {
    const onChange = vi.fn();
    renderToolbar({
      snapshot: snapshot({ isText: true, tagName: "H2", fontWeight: "700" }),
      onChange,
    });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenCalledWith({ fontWeight: "400" });
  });

  it("adds strikethrough without dropping underline", () => {
    const onChange = vi.fn();
    renderToolbar({
      snapshot: snapshot({
        isText: true,
        tagName: "H2",
        textDecoration: "underline",
      }),
      onChange,
    });
    fireEvent.click(screen.getByRole("button", { name: "Strikethrough" }));
    expect(onChange).toHaveBeenCalledWith({
      textDecoration: "underline line-through",
    });
  });

  it("replaces an image and has no text controls", () => {
    const onReplaceImage = vi.fn();
    renderToolbar({
      snapshot: snapshot({ isImage: true, tagName: "IMG" }),
      onReplaceImage,
      onOpenAgent: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace image" }));
    expect(onReplaceImage).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
  });

  it("counts a multi-selection", () => {
    renderToolbar({
      snapshot: snapshot(),
      hasSelectedElement: true,
      objectSelectionCount: 3,
    });
    expect(screen.getByText(/objects selected/i)).toBeTruthy();
  });
});

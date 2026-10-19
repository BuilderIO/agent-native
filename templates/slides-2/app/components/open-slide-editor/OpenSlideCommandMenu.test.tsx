// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenSlideCommandMenu } from "./OpenSlideCommandMenu";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({
    children,
    heading,
  }: {
    children: ReactNode;
    heading: string;
  }) => <section data-group-heading={heading}>{children}</section>,
  CommandInput: ({
    onValueChange,
    ...props
  }: ComponentProps<"input"> & {
    onValueChange?: (value: string) => void;
  }) => (
    <input
      {...props}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    />
  ),
  CommandItem: ({
    children,
    onSelect,
    disabled,
    value,
    keywords,
  }: {
    children: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
    value?: string;
    keywords?: string[];
  }) => (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      data-command-value={value}
      data-command-keywords={keywords?.join(" ")}
    >
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandShortcut: ({ children }: { children: ReactNode }) => (
    <kbd>{children}</kbd>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
});

function makeProps(
  overrides: Partial<ComponentProps<typeof OpenSlideCommandMenu>> = {},
): ComponentProps<typeof OpenSlideCommandMenu> {
  return {
    open: true,
    onOpenChange: vi.fn(),
    slides: [
      { id: "slide-1", slideNumber: 1, textPreview: "Quarterly Revenue" },
      { id: "slide-2", slideNumber: 2, textPreview: "Next Steps" },
      { id: "slide-3", slideNumber: 3, textPreview: "Close" },
    ],
    activeIndex: 1,
    canEdit: true,
    canComment: true,
    canUndo: true,
    canRedo: true,
    onSelectSlide: vi.fn(),
    onAddSlide: vi.fn(),
    onInsertObject: vi.fn(),
    onDuplicateSlide: vi.fn(),
    onDeleteSlide: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onPresent: vi.fn(),
    onOpenPresenter: vi.fn(),
    onOpenOverview: vi.fn(),
    onToggleDesignPanel: vi.fn(),
    onToggleCommentMode: vi.fn(),
    onCopyLink: vi.fn(),
    onOpenAssets: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
}

function command(id: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-command-value="${id}"]`,
  );
  if (!button) throw new Error(`Missing command: ${id}`);
  return button;
}

describe("OpenSlideCommandMenu", () => {
  it("dispatches windowed presentation and copy-link commands", () => {
    const onPresent = vi.fn();
    const onCopyLink = vi.fn();
    const onExport = vi.fn();

    render(
      <OpenSlideCommandMenu
        open
        onOpenChange={vi.fn()}
        slides={[{ id: "slide-1", slideNumber: 1 }]}
        activeIndex={0}
        canEdit
        canComment={false}
        canUndo={false}
        canRedo={false}
        onSelectSlide={vi.fn()}
        onAddSlide={vi.fn()}
        onInsertObject={vi.fn()}
        onDuplicateSlide={vi.fn()}
        onDeleteSlide={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onPresent={onPresent}
        onOpenPresenter={vi.fn()}
        onOpenOverview={vi.fn()}
        onToggleDesignPanel={vi.fn()}
        onToggleCommentMode={vi.fn()}
        onCopyLink={onCopyLink}
        onOpenAssets={vi.fn()}
        onExport={onExport}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /openSlideEditor\.presentInWindow/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "share.copyLink" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "editorExport.exportPptxAsImages",
      }),
    );

    expect(onPresent).toHaveBeenCalledWith("windowed");
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledWith("pptx-images");
    expect(screen.getByText("F")).toBeTruthy();
    expect(screen.getByText("↵")).toBeTruthy();
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.getByText("O")).toBeTruthy();
  });

  it("runs the comment toggle for commenters and disables it otherwise", () => {
    const onToggleCommentMode = vi.fn();
    const props: ComponentProps<typeof OpenSlideCommandMenu> = {
      open: true,
      onOpenChange: vi.fn(),
      slides: [{ id: "slide-1", slideNumber: 1 }],
      activeIndex: 0,
      canEdit: true,
      canComment: true,
      canUndo: false,
      canRedo: false,
      onSelectSlide: vi.fn(),
      onAddSlide: vi.fn(),
      onInsertObject: vi.fn(),
      onDuplicateSlide: vi.fn(),
      onDeleteSlide: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      onPresent: vi.fn(),
      onOpenOverview: vi.fn(),
      onToggleDesignPanel: vi.fn(),
      onToggleCommentMode,
      onCopyLink: vi.fn(),
      onOpenAssets: vi.fn(),
      onExport: vi.fn(),
    };
    const { rerender } = render(<OpenSlideCommandMenu {...props} />);

    const commentToggle = screen.getByRole("button", {
      name: "comments.addComment",
    });
    expect((commentToggle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(commentToggle);
    expect(onToggleCommentMode).toHaveBeenCalledOnce();

    rerender(<OpenSlideCommandMenu {...props} canComment={false} />);
    const unauthorizedToggle = screen.getByRole("button", {
      name: "comments.addComment",
    });
    expect((unauthorizedToggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(unauthorizedToggle);
    expect(onToggleCommentMode).toHaveBeenCalledOnce();
  });

  it("opens with Command-K while an editor text field has focus", () => {
    const onOpenChange = vi.fn();
    const input = document.createElement("input");
    document.body.append(input);

    render(
      <OpenSlideCommandMenu
        open={false}
        onOpenChange={onOpenChange}
        slides={[{ id: "slide-1", slideNumber: 1 }]}
        activeIndex={0}
        canEdit
        canComment={false}
        canUndo={false}
        canRedo={false}
        onSelectSlide={vi.fn()}
        onAddSlide={vi.fn()}
        onInsertObject={vi.fn()}
        onDuplicateSlide={vi.fn()}
        onDeleteSlide={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onPresent={vi.fn()}
        onOpenOverview={vi.fn()}
        onToggleDesignPanel={vi.fn()}
        onToggleCommentMode={vi.fn()}
        onCopyLink={vi.fn()}
        onOpenAssets={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    fireEvent.keyDown(input, { key: "k", ctrlKey: true });

    expect(onOpenChange).toHaveBeenCalledWith(true);
    input.remove();
  });

  it("keeps the active slide selectable in the searched page commands", () => {
    const onSelectSlide = vi.fn();

    render(
      <OpenSlideCommandMenu
        open
        onOpenChange={vi.fn()}
        slides={[
          {
            id: "slide-1",
            slideNumber: 1,
            textPreview: "Quarterly Revenue",
          },
        ]}
        activeIndex={0}
        canEdit
        canComment={false}
        canUndo={false}
        canRedo={false}
        onSelectSlide={onSelectSlide}
        onAddSlide={vi.fn()}
        onInsertObject={vi.fn()}
        onDuplicateSlide={vi.fn()}
        onDeleteSlide={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        onPresent={vi.fn()}
        onOpenOverview={vi.fn()}
        onToggleDesignPanel={vi.fn()}
        onToggleCommentMode={vi.fn()}
        onCopyLink={vi.fn()}
        onOpenAssets={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByPlaceholderText("openSlideEditor.searchCommands"),
      {
        target: { value: "page 1" },
      },
    );
    const activeSlide = screen.getByRole("button", {
      name: /openSlidePresenter\.slideLabel/,
    });

    expect((activeSlide as HTMLButtonElement).disabled).toBe(false);
    expect(activeSlide.getAttribute("data-command-value")).toBe(
      "slide-slide-1",
    );
    expect(activeSlide.getAttribute("data-command-keywords")).toContain("page");
    expect(activeSlide.getAttribute("data-command-keywords")).toContain(
      "Quarterly Revenue",
    );
    fireEvent.click(activeSlide);
    expect(onSelectSlide).toHaveBeenCalledWith(0);
  });

  it("toggles on Command-K or Control-K and ignores unrelated or repeated keys", () => {
    const onOpenChange = vi.fn();
    const props = makeProps({ open: false, onOpenChange });
    const { rerender } = render(<OpenSlideCommandMenu {...props} />);
    const input = document.createElement("input");
    document.body.append(input);

    const controlK = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
    });
    input.dispatchEvent(controlK);
    expect(controlK.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(<OpenSlideCommandMenu {...props} open />);
    const commandK = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "K",
      metaKey: true,
    });
    input.dispatchEvent(commandK);
    expect(commandK.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    const repeat = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
      repeat: true,
    });
    input.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true }),
    );
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    input.remove();
  });

  it("exposes source export search aliases on every export command", () => {
    render(<OpenSlideCommandMenu {...makeProps()} />);

    expect(command("export-html").dataset.commandKeywords).toContain(
      "export html download",
    );
    expect(command("export-pdf").dataset.commandKeywords).toContain(
      "export pdf download print",
    );
    expect(command("export-pptx").dataset.commandKeywords).toContain(
      "export pptx powerpoint download editable",
    );
    expect(command("export-pptx-images").dataset.commandKeywords).toContain(
      "export pptx powerpoint download",
    );
    expect(command("export-google-slides").dataset.commandKeywords).toContain(
      "export google slides presentation",
    );
  });

  it("shows the design shortcut only in development builds", () => {
    const onToggleDesignPanel = vi.fn();
    render(<OpenSlideCommandMenu {...makeProps({ onToggleDesignPanel })} />);

    const designCommand = command("design-tokens");
    const shortcut = designCommand.querySelector("kbd");
    if (import.meta.env.DEV) {
      expect(shortcut?.textContent).toBe("D");
    } else {
      expect(shortcut).toBeNull();
    }
    fireEvent.click(designCommand);
    expect(onToggleDesignPanel).toHaveBeenCalledOnce();
  });

  it("opens presenter view before starting windowed presentation", () => {
    const events: string[] = [];
    render(
      <OpenSlideCommandMenu
        {...makeProps({
          onOpenPresenter: () => events.push("open-presenter"),
          onPresent: (mode) => events.push(`present:${mode}`),
        })}
      />,
    );

    fireEvent.click(command("presenter-view"));

    expect(events).toEqual(["open-presenter", "present:windowed"]);
  });

  it("adds back-to-slides only with a caller route and navigates to that route", () => {
    const onOpenChange = vi.fn();
    const props = makeProps({ onOpenChange });
    const { rerender } = render(<OpenSlideCommandMenu {...props} />);

    expect(
      document.querySelector('[data-command-value="back-to-slides"]'),
    ).toBeNull();

    rerender(<OpenSlideCommandMenu {...props} backHref="/home?tab=recent" />);
    const backCommand = command("back-to-slides");
    expect(backCommand.dataset.commandKeywords).toContain("home back slides");
    fireEvent.click(backCommand);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateMock).toHaveBeenCalledWith("/home?tab=recent");
  });

  it("dispatches every enabled edit, view, export, and page command after closing", () => {
    const events: string[] = [];
    const onOpenChange = vi.fn((open: boolean) => {
      events.push(`open:${open}`);
    });
    const onUndo = vi.fn(() => events.push("undo"));
    const onRedo = vi.fn();
    const onAddSlide = vi.fn();
    const onDuplicateSlide = vi.fn();
    const onDeleteSlide = vi.fn();
    const onToggleCommentMode = vi.fn();
    const onInsertObject = vi.fn();
    const onPresent = vi.fn();
    const onOpenPresenter = vi.fn();
    const onOpenOverview = vi.fn();
    const onToggleDesignPanel = vi.fn();
    const onCopyLink = vi.fn();
    const onSelectSlide = vi.fn();
    const onOpenAssets = vi.fn();
    const onExport = vi.fn();

    const props = makeProps({
      onOpenChange,
      onUndo,
      onRedo,
      onAddSlide,
      onDuplicateSlide,
      onDeleteSlide,
      onToggleCommentMode,
      onInsertObject,
      onPresent,
      onOpenPresenter,
      onOpenOverview,
      onToggleDesignPanel,
      onCopyLink,
      onSelectSlide,
      onOpenAssets,
      onExport,
    });
    const { container } = render(<OpenSlideCommandMenu {...props} />);

    fireEvent.click(command("undo"));
    expect(events.slice(0, 2)).toEqual(["open:false", "undo"]);
    fireEvent.click(command("redo"));
    fireEvent.click(command("add-slide"));
    fireEvent.click(command("duplicate-slide"));
    fireEvent.click(command("delete-slide"));
    fireEvent.click(command("toggle-comments"));
    fireEvent.click(command("insert-text"));
    fireEvent.click(command("insert-rectangle"));
    fireEvent.click(command("insert-ellipse"));
    fireEvent.click(command("insert-line"));
    fireEvent.click(command("present-fullscreen"));
    fireEvent.click(command("present-windowed"));
    fireEvent.click(command("presenter-view"));
    fireEvent.click(command("overview"));
    fireEvent.click(command("design-tokens"));
    fireEvent.click(command("copy-link"));
    fireEvent.click(command("previous-slide"));
    fireEvent.click(command("next-slide"));
    fireEvent.click(command("asset-library"));
    fireEvent.click(command("export-html"));
    fireEvent.click(command("export-pdf"));
    fireEvent.click(command("export-pptx"));
    fireEvent.click(command("export-pptx-images"));
    fireEvent.click(command("export-google-slides"));

    expect(onRedo).toHaveBeenCalledOnce();
    expect(onAddSlide).toHaveBeenCalledOnce();
    expect(onDuplicateSlide).toHaveBeenCalledWith(1);
    expect(onDeleteSlide).toHaveBeenCalledWith(1);
    expect(onToggleCommentMode).toHaveBeenCalledOnce();
    expect(onInsertObject.mock.calls).toEqual([
      ["text"],
      ["rectangle"],
      ["ellipse"],
      ["line"],
    ]);
    expect(onPresent.mock.calls).toEqual([
      ["fullscreen"],
      ["windowed"],
      ["windowed"],
    ]);
    expect(onOpenPresenter).toHaveBeenCalledOnce();
    expect(onOpenOverview).toHaveBeenCalledOnce();
    expect(onToggleDesignPanel).toHaveBeenCalledOnce();
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(onSelectSlide.mock.calls).toEqual([[0], [2]]);
    expect(onOpenAssets).toHaveBeenCalledOnce();
    expect(onExport.mock.calls).toEqual([
      ["html"],
      ["pdf"],
      ["pptx"],
      ["pptx-images"],
      ["google-slides"],
    ]);

    expect(
      container.querySelector(
        '[data-group-heading="openSlidePresenter.overview"]',
      ),
    ).toBeNull();
    fireEvent.change(
      screen.getByPlaceholderText("openSlideEditor.searchCommands"),
      { target: { value: "page 2" } },
    );
    expect(
      container.querySelector(
        '[data-group-heading="openSlidePresenter.overview"]',
      ),
    ).not.toBeNull();
    const activePage = command("slide-slide-2");
    expect(activePage.querySelectorAll("svg").length).toBeGreaterThan(1);
    fireEvent.click(activePage);
    expect(onSelectSlide).toHaveBeenLastCalledWith(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables edit, comment, and history commands without permission or history", () => {
    const props = makeProps({
      canEdit: false,
      canComment: false,
      canUndo: false,
      canRedo: false,
    });
    const { rerender } = render(<OpenSlideCommandMenu {...props} />);

    for (const id of [
      "undo",
      "redo",
      "add-slide",
      "duplicate-slide",
      "delete-slide",
      "toggle-comments",
      "insert-text",
      "insert-rectangle",
      "insert-ellipse",
      "insert-line",
    ]) {
      expect(command(id).disabled, `${id} should be disabled`).toBe(true);
      fireEvent.click(command(id));
    }
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(props.onUndo).not.toHaveBeenCalled();
    expect(props.onToggleCommentMode).not.toHaveBeenCalled();

    rerender(
      <OpenSlideCommandMenu
        {...props}
        canEdit
        canUndo
        canRedo
        slides={[{ id: "only-slide", slideNumber: 1 }]}
        onOpenPresenter={undefined}
      />,
    );
    expect(command("delete-slide").disabled).toBe(true);
    expect(command("presenter-view").disabled).toBe(true);
  });

  it("disables slide-dependent commands for an empty deck and clamps navigation", () => {
    const onSelectSlide = vi.fn();
    const props = makeProps({ slides: [], activeIndex: 0, onSelectSlide });
    const { rerender } = render(<OpenSlideCommandMenu {...props} />);

    for (const id of [
      "duplicate-slide",
      "delete-slide",
      "present-fullscreen",
      "present-windowed",
      "presenter-view",
      "overview",
      "previous-slide",
      "next-slide",
      "export-html",
      "export-pdf",
      "export-pptx",
      "export-pptx-images",
      "export-google-slides",
    ]) {
      expect(command(id).disabled, `${id} should be disabled`).toBe(true);
      fireEvent.click(command(id));
    }
    expect(props.onOpenChange).not.toHaveBeenCalled();

    rerender(
      <OpenSlideCommandMenu
        {...props}
        slides={[{ id: "first-slide", slideNumber: 1 }]}
      />,
    );
    expect(command("previous-slide").disabled).toBe(true);
    expect(command("next-slide").disabled).toBe(true);
  });
});

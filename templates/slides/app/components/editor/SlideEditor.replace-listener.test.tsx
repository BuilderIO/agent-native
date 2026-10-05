// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getRenderedSlideSource,
  renderRawSlideHtml,
} from "@/components/deck/SlideRenderer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";
import * as slideCommentAnchor from "@/lib/slide-comment-anchor";
import {
  captureSlideImageUploadProvenance,
  registerSlideImageUploadProvenance,
} from "@/lib/slide-image-replacement";

import SlideEditor from "./SlideEditor";

vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({
    enabled: false,
    isLoading: false,
    isError: false,
    isSuccess: true,
  }),
}));
const t = (key: string) => key;
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useT: () => t,
}));
vi.mock("@/components/deck/ExcalidrawSlide", () => ({
  ExcalidrawSlide: () => <div data-excalidraw-canvas="true" />,
  ExcalidrawThumbnail: () => null,
  parseExcalidrawData: (json?: string) => (json ? JSON.parse(json) : null),
}));
vi.mock("@/root", () => ({ enterSelectionMode: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

describe("SlideEditor with a newer version of the edited slide", () => {
  it("keeps the first image selected when Shift-clicking another image", async () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const noop = () => {};
    const slide = {
      id: "slide-image-multiselect",
      content:
        '<div class="fmd-slide"><img src="https://example.test/first.svg" alt="First"><img src="https://example.test/second.svg" alt="Second"></div>',
      layout: "blank",
    } as Slide;
    const { container } = render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={() => undefined}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
      />,
      { wrapper: Providers },
    );
    const slideCanvas = container.querySelector<HTMLElement>(".fmd-slide")!;
    vi.spyOn(slideCanvas, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 1200, 675),
    );
    Object.defineProperty(slideCanvas, "offsetWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(slideCanvas, "offsetHeight", {
      configurable: true,
      value: 675,
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    const [first, second] =
      container.querySelectorAll<HTMLImageElement>(".slide-content img");
    fireEvent.pointerDown(first, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(first, { button: 0, pointerId: 1 });
    fireEvent.click(first);
    fireEvent.pointerDown(second, {
      button: 0,
      pointerId: 2,
      shiftKey: true,
    });
    fireEvent.pointerUp(second, { button: 0, pointerId: 2, shiftKey: true });
    fireEvent.click(second, { shiftKey: true });

    expect(
      document.querySelector("[data-multi-select-chip] span")?.textContent,
    ).toBe("2");
  });

  it("saves a text edit when the page hides before the draft debounce fires", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const onUpdateSlide = vi.fn(
      (_updates: Partial<Slide>, _slideId?: string, _options?: object) =>
        undefined,
    );
    const noop = () => {};
    const slide = {
      id: "slide-pagehide",
      content: '<div class="fmd-slide"><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={onUpdateSlide}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
      />,
      { wrapper: Providers },
    );

    const edited = document.querySelector<HTMLElement>(".slide-content p")!;
    fireEvent.doubleClick(edited, { detail: 2 });
    (edited.firstChild as Text).data = "Caption typed";
    fireEvent.input(edited);
    fireEvent(window, new Event("pagehide"));

    expect(onUpdateSlide).toHaveBeenCalledWith(
      { content: expect.stringContaining("Caption typed") },
      slide.id,
      { preserveLocalState: true },
    );
  });

  it("refocuses the canvas after Escape and keeps the layer selected", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const onUpdateSlide = vi.fn(
      (_updates: Partial<Slide>, _slideId?: string, _options?: object) =>
        undefined,
    );
    const noop = () => {};
    const slide = {
      id: "slide-escape-focus",
      content: '<div class="fmd-slide"><h2>Title</h2><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    const { container } = render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={onUpdateSlide}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
      />,
      { wrapper: Providers },
    );
    const edited = container.querySelector<HTMLElement>(".slide-content p")!;
    fireEvent.doubleClick(edited, { detail: 2 });
    expect(edited.getAttribute("contenteditable")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });

    const canvas = container.querySelector<HTMLElement>(
      "[data-slide-canvas-focus='true']",
    )!;
    expect(document.activeElement).toBe(canvas);
    expect(
      container
        .querySelector<HTMLElement>(".slide-content p")
        ?.getAttribute("contenteditable"),
    ).not.toBe("true");
    expect(
      container.querySelector("[data-slide-element-selected='true']"),
    ).not.toBeNull();

    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(
      onUpdateSlide.mock.calls.some(
        ([updates]) =>
          !String((updates as Partial<Slide>).content ?? "").includes(
            "Caption",
          ),
      ),
    ).toBe(true);
  });

  it("clears the selected layer on a second Escape", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const noop = () => {};
    const slide = {
      id: "slide-escape-clear",
      content: '<div class="fmd-slide"><h2>Title</h2><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    const { container } = render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={() => undefined}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
      />,
      { wrapper: Providers },
    );
    const edited = container.querySelector<HTMLElement>(".slide-content p")!;
    fireEvent.doubleClick(edited, { detail: 2 });
    const canvas = container.querySelector<HTMLElement>(
      "[data-slide-canvas-focus='true']",
    )!;
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      container.querySelector("[data-slide-element-selected='true']"),
    ).not.toBeNull();

    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(
      container.querySelector("[data-slide-element-selected='true']"),
    ).toBeNull();
  });

  it("does not change nested slide text when dismissing its context menu", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const onUpdateSlide = vi.fn(
      (_updates: Partial<Slide>, _slideId?: string, _options?: object) =>
        undefined,
    );
    const noop = () => {};
    const paragraph =
      "Teams are consolidating software and want fewer, better systems.";
    const slide = {
      id: "slide-context-menu-dismiss",
      content: `<div class="fmd-slide"><div style="display:grid"><div><h3>Why now</h3><p>${paragraph}</p></div></div></div>`,
      layout: "content",
    } as Slide;
    const { container, getByRole } = render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={onUpdateSlide}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
      />,
      { wrapper: Providers },
    );
    const edited = container.querySelector<HTMLElement>(".slide-content p")!;
    fireEvent.doubleClick(edited, { detail: 2 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(edited.getAttribute("contenteditable")).not.toBe("true");

    edited.removeAttribute("data-builder-id");
    fireEvent.contextMenu(edited, { button: 2 });
    expect(getByRole("menu")).toBeTruthy();
    expect(edited.getAttribute("data-builder-id")).toBeTruthy();
    expect(
      getByRole("menuitem", { name: /editorSidebar\.duplicate/ }).getAttribute(
        "aria-disabled",
      ),
    ).not.toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(container.querySelector(".slide-content p")?.textContent).toBe(
      paragraph,
    );
    expect(
      onUpdateSlide.mock.calls.filter(([updates]) =>
        Object.hasOwn(updates, "content"),
      ),
    ).toHaveLength(0);
  });

  it("keeps a comment-highlight click in the active text editor", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    vi.spyOn(slideCommentAnchor, "slideCommentThreadAtPoint").mockReturnValue(
      "thread-1",
    );
    const onSelectCommentThread = vi.fn();
    const noop = () => {};
    const slide = {
      id: "slide-comment-caret",
      content: '<div class="fmd-slide"><h2>Title</h2><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    const { container } = render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={() => undefined}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
        onSelectCommentThread={onSelectCommentThread}
      />,
      { wrapper: Providers },
    );
    const text = container.querySelector<HTMLElement>(".slide-content p")!;

    fireEvent.pointerDown(text, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.doubleClick(text, { detail: 2 });
    expect(text.getAttribute("contenteditable")).toBe("true");

    fireEvent.click(text, { clientX: 10, clientY: 10 });

    expect(onSelectCommentThread).not.toHaveBeenCalled();
    expect(text.getAttribute("contenteditable")).toBe("true");
  });

  it("lets a modifier-click on commented text toggle multi-selection instead of opening the thread", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    vi.spyOn(slideCommentAnchor, "slideCommentThreadAtPoint").mockReturnValue(
      "thread-1",
    );
    const onSelectCommentThread = vi.fn();
    const noop = () => {};
    const slide = {
      id: "slide-comment-modifier",
      content: '<div class="fmd-slide"><h2>Title</h2><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    const { container } = render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={() => undefined}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
        onSelectCommentThread={onSelectCommentThread}
      />,
      { wrapper: Providers },
    );
    const text = container.querySelector<HTMLElement>(".slide-content p")!;

    for (const modifier of ["shiftKey", "metaKey", "ctrlKey"] as const) {
      const point = { button: 0, clientX: 10, clientY: 10, [modifier]: true };
      fireEvent.pointerDown(text, point);
      fireEvent.click(text, point);
    }
    expect(onSelectCommentThread).not.toHaveBeenCalled();

    const plain = { button: 0, clientX: 10, clientY: 10 };
    fireEvent.pointerDown(text, plain);
    fireEvent.click(text, plain);
    expect(onSelectCommentThread).toHaveBeenCalledWith("thread-1");
  });

  it("cancels a plain link drop without treating it as an image", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const onDropImageUrl = vi.fn();
    const noop = () => {};
    const slide = {
      id: "slide-link-drop",
      content: '<div class="fmd-slide"><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    render(
      <SlideEditor
        slide={slide}
        onUpdateSlide={() => undefined}
        onGenerateImage={noop}
        onOpenAssetLibrary={noop}
        onUploadImage={noop}
        onDropImageUrl={onDropImageUrl}
        onToggleObjectFit={noop}
        onChangeObjectPosition={noop}
      />,
      { wrapper: Providers },
    );

    const canvas = document.querySelector<HTMLElement>(
      ".slide-image-clickable",
    )!;
    for (const types of [["text/html", "text/uri-list"], ["text/uri-list"]]) {
      const dataTransfer = {
        files: [],
        items: [],
        types,
        dropEffect: "none",
        getData: (type: string) =>
          type === "text/html" && types.includes("text/html")
            ? '<a href="https://example.test">Link</a>'
            : "",
      } as unknown as DataTransfer;

      expect(fireEvent.dragOver(canvas, { dataTransfer })).toBe(false);
      expect(fireEvent.drop(canvas, { dataTransfer })).toBe(false);
    }
    expect(onDropImageUrl).not.toHaveBeenCalled();
  });

  it("saves an open edit on top of it after the editor first showed an Excalidraw slide", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const onUpdateSlide = vi.fn((_updates: Partial<Slide>) => undefined);
    const noop = () => {};
    const props = {
      onUpdateSlide,
      onGenerateImage: noop,
      onOpenAssetLibrary: noop,
      onUploadImage: noop,
      onToggleObjectFit: noop,
      onChangeObjectPosition: noop,
    };
    const drawing = {
      id: "slide-draw",
      content: "",
      layout: "blank",
      excalidrawData: JSON.stringify({ elements: [{ id: "a" }] }),
    } as Slide;
    const html = {
      id: "slide-html",
      content: '<div class="fmd-slide"><h2>Title</h2><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    const { rerender } = render(<SlideEditor slide={drawing} {...props} />, {
      wrapper: Providers,
    });
    rerender(<SlideEditor slide={html} {...props} />);

    const edited = document.querySelector<HTMLElement>(".slide-content p")!;
    fireEvent.doubleClick(edited, { detail: 2 });
    expect(edited.getAttribute("contenteditable")).toBe("true");
    (edited.firstChild as Text).data = "Caption typed";

    const newer = html.content.replace("Title", "Agent title");
    rerender(<SlideEditor slide={{ ...html, content: newer }} {...props} />);

    expect(onUpdateSlide.mock.calls.map(([updates]) => updates)).toContainEqual(
      {
        content:
          '<div class="fmd-slide"><h2>Agent title</h2><p>Caption typed</p></div>',
      },
    );
    expect(edited.hasAttribute("contenteditable")).toBe(false);
    expect(errors).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("refused to re-render"),
      }),
    );
  });

  async function editWithDraft() {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onUpdateSlide = vi.fn(
      (_updates: Partial<Slide>, _slideId?: string, _options?: object) =>
        undefined,
    );
    const noop = () => {};
    const props = {
      onUpdateSlide,
      onGenerateImage: noop,
      onOpenAssetLibrary: noop,
      onUploadImage: noop,
      onToggleObjectFit: noop,
      onChangeObjectPosition: noop,
    };
    const slide = {
      id: "slide-img",
      content:
        '<div class="fmd-slide"><img src="https://cdn.test/old.png" style="width:100px"><p>Caption</p></div>',
      layout: "blank",
    } as Slide;
    const view = render(<SlideEditor slide={slide} {...props} />, {
      wrapper: Providers,
    });
    const edited = document.querySelector<HTMLElement>(".slide-content p")!;
    fireEvent.doubleClick(edited, { detail: 2 });
    (edited.firstChild as Text).data = "Caption ty";
    fireEvent.input(edited);
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const draft = onUpdateSlide.mock.calls.find(
      ([, , options]) =>
        (options as { preserveLocalState?: boolean } | undefined)
          ?.preserveLocalState,
    )?.[0].content;
    expect(draft).toContain("Caption ty");
    (edited.firstChild as Text).data = "Caption typed";
    const rerender = (content: string) =>
      view.rerender(<SlideEditor slide={{ ...slide, content }} {...props} />);
    const registerUpload = (content: string) => {
      const root = document.querySelector<HTMLElement>(".slide-content")!;
      const source = getRenderedSlideSource(root)!;
      const scopeId = root.getAttribute("data-slide-content-scope")!;
      const sourceSnapshot = renderRawSlideHtml(draft!, {
        scopeSelector: `[data-slide-content-scope="${scopeId}"]`,
        stampNonce: source.nonce,
      });
      const provenance = captureSlideImageUploadProvenance(
        root,
        sourceSnapshot.html,
      )!;
      registerSlideImageUploadProvenance(slide.id, content, provenance);
    };
    return { draft: draft!, edited, onUpdateSlide, registerUpload, rerender };
  }

  it("keeps an edit open under an upload built on its own draft", async () => {
    const { draft, edited, registerUpload, rerender } = await editWithDraft();
    const uploaded = draft.replace("old.png", "new.png");
    registerUpload(uploaded);
    rerender(uploaded);
    expect(edited.getAttribute("contenteditable")).toBe("true");
    expect(edited.textContent).toBe("Caption typed");
    expect(
      document.querySelector(".slide-content img")!.getAttribute("src"),
    ).toBe("https://cdn.test/new.png");
  });

  it("keeps typing after its persisted draft echoes back into the open edit", async () => {
    const { draft, edited, onUpdateSlide, rerender } = await editWithDraft();
    rerender(draft);

    expect(edited.getAttribute("contenteditable")).toBe("true");
    expect(
      getRenderedSlideSource(
        document.querySelector<HTMLElement>(".slide-content")!,
      )?.stored,
    ).toBe(draft);

    (edited.firstChild as Text).data = "Caption typed more";
    fireEvent.input(edited);
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));

    const drafts = onUpdateSlide.mock.calls
      .filter(
        ([, , options]) =>
          (options as { preserveLocalState?: boolean } | undefined)
            ?.preserveLocalState,
      )
      .map(([updates]) => updates.content);
    expect(drafts.at(-1)).toContain("Caption typed more");
    expect(edited.getAttribute("contenteditable")).toBe("true");
  });

  it("ends an edit whose text another writer changed along with an image", async () => {
    const { draft, edited, onUpdateSlide, registerUpload, rerender } =
      await editWithDraft();
    const remote = draft
      .replace("old.png", "new.png")
      .replace("Caption ty", "Agent caption");
    registerUpload(remote);
    rerender(remote);
    expect(edited.hasAttribute("contenteditable")).toBe(false);
    expect(onUpdateSlide.mock.calls.at(-1)?.[0]).toEqual({ content: remote });
  });
});

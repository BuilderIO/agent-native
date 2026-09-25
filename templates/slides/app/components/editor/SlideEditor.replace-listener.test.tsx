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
// A new `t` each render would re-run the editor's unmount cleanup and end
// every edit; the app's `t` is stable.
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

  /** Opens an edit on the caption and waits for its first draft. */
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

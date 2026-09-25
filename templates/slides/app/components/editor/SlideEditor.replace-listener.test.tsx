// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Slide } from "@/context/DeckContext";

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
    const onUpdateSlide = vi.fn(() => undefined);
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
});

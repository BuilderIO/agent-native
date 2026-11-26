// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

describe("SlideEditor deleting the object whose text is being edited", () => {
  it.each(["editorSidebar.cut", "editorSidebar.delete"])(
    "%s from the context menu removes it without reporting a lost edit",
    async (menuLabel) => {
      vi.stubGlobal("fetch", () => new Promise(() => {}));
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const onUpdateSlide = vi.fn(
        (_updates: Partial<Slide>, _slideId?: string, _options?: object) =>
          undefined,
      );
      const noop = () => {};
      const slide = {
        id: "slide-delete-while-editing",
        content:
          '<div class="fmd-slide"><div data-slide-object-id="a" style="position:absolute;left:40px;top:40px;width:300px">Alpha</div><div data-slide-object-id="b" style="position:absolute;left:40px;top:200px;width:300px">Beta</div></div>',
        layout: "blank",
      } as Slide;
      render(
        <SlideEditor
          slide={slide}
          deckId="deck-delete"
          onUpdateSlide={onUpdateSlide}
          onGenerateImage={noop}
          onOpenAssetLibrary={noop}
          onUploadImage={noop}
          onToggleObjectFit={noop}
          onChangeObjectPosition={noop}
        />,
        { wrapper: Providers },
      );

      const edited = document.querySelector<HTMLElement>(
        '.slide-content [data-slide-object-id="a"]',
      );
      if (!edited) throw new Error("the edited object did not render");
      fireEvent.doubleClick(edited, { detail: 2 });
      expect(edited.getAttribute("contenteditable")).toBe("true");
      (edited.firstChild as Text).data = "Alpha typed";
      fireEvent.input(edited);

      fireEvent.contextMenu(edited, { button: 2 });
      const item = await screen.findByText(menuLabel);
      act(() => {
        fireEvent.click(item);
      });

      expect(
        document.querySelector('.slide-content [data-slide-object-id="a"]'),
      ).toBeNull();
      const lastContent = onUpdateSlide.mock.calls.at(-1)?.[0].content;
      expect(lastContent).not.toContain("Alpha");
      expect(lastContent).toContain("Beta");
      expect(
        onUpdateSlide.mock.calls.some(([updates]) =>
          updates.content?.includes("Alpha typed"),
        ),
      ).toBe(true);
      expect(
        consoleError.mock.calls.some(([error]) =>
          String(error).includes("left the slide before its edit was saved"),
        ),
      ).toBe(false);
    },
  );
});

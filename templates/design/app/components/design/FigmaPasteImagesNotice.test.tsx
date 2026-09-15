// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismissPopover: () => {},
  hydrateImagesFromFig: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@tabler/icons-react", () =>
  Object.fromEntries(
    [
      "IconBellOff",
      "IconChevronDown",
      "IconPhotoOff",
      "IconPlugConnected",
      "IconUpload",
      "IconX",
    ].map((name) => [name, () => null]),
  ),
);

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const PopoverContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);

  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) => {
      mocks.dismissPopover = () => onOpenChange(false);
      return (
        <PopoverContext.Provider value={{ open, onOpenChange }}>
          {children}
        </PopoverContext.Provider>
      );
    },
    PopoverTrigger: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const popover = React.useContext(PopoverContext)!;
      return (
        <button {...props} onClick={() => popover.onOpenChange(!popover.open)}>
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children: React.ReactNode }) => {
      const popover = React.useContext(PopoverContext)!;
      return popover.open ? <div>{children}</div> : null;
    },
  };
});

vi.mock("@/lib/design-file-upload", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/design-file-upload")>();
  return { ...actual, hydrateImagesFromFig: mocks.hydrateImagesFromFig };
});

vi.mock("@/lib/utils", () => ({
  cn: (...classes: string[]) => classes.join(" "),
}));

import { FigmaPasteImagesNotice } from "./FigmaPasteImagesNotice";

describe("FigmaPasteImagesNotice file picker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.hydrateImagesFromFig.mockResolvedValue({ totalResolved: 1 });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("keeps the selected-file handler mounted if the chooser dismisses the popover", async () => {
    await act(async () =>
      root.render(
        <FigmaPasteImagesNotice
          count={1}
          designId="design-1"
          fileIds={["screen-1"]}
          onConnect={vi.fn()}
          onDismissForever={vi.fn()}
          onHydrated={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="designEditor.import.figmaHydrationDialogTitle"]',
        )!
        .click(),
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    vi.spyOn(input, "click").mockImplementation(() => mocks.dismissPopover());

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) =>
          button.textContent?.includes(
            "designEditor.import.figmaHydrationChooseFig",
          ),
        )!
        .click();
    });

    expect(input.isConnected).toBe(true);
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["fig"], "source.fig")],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );

    expect(mocks.hydrateImagesFromFig).toHaveBeenCalledWith(
      expect.objectContaining({
        designId: "design-1",
        fileIds: ["screen-1"],
        file: expect.any(File),
      }),
    );
  });
});

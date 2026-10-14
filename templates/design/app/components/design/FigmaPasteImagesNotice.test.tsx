// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dismissPopover: () => {},
  hydrateImagesFromFig: vi.fn(),
  callAction: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorMessage: () => undefined,
  callAction: mocks.callAction,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key} ${JSON.stringify(options)}` : key,
}));

vi.mock("@tabler/icons-react", () =>
  Object.fromEntries(
    [
      "IconBellOff",
      "IconChevronDown",
      "IconPhotoOff",
      "IconPhotoUp",
      "IconPlugConnected",
      "IconUpload",
      "IconX",
    ].map((name) => [name, () => null]),
  ),
);

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(() => "loading"),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }));

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
          getScreenContent={() => ""}
          uploadImage={vi.fn()}
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
    const input = container.querySelector<HTMLInputElement>(
      'input[accept=".fig"]',
    )!;
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

  const missingImage = (hash: string, name: string) =>
    `<div data-agent-native-layer-name="${name}" data-figma-image-ref="${hash}" style="background-image: url('about:blank');"></div>`;

  async function renderNotice(
    html: string | Record<string, string>,
    overrides: Partial<{
      uploadImage: (file: File) => Promise<string>;
      onClose: () => void;
      onHydrated: () => void;
    }> = {},
  ) {
    const screens = typeof html === "string" ? { "screen-1": html } : html;
    const props = {
      uploadImage: vi.fn(async () => "https://cdn.example.com/robot.svg"),
      onClose: vi.fn(),
      onHydrated: vi.fn(),
      ...overrides,
    };
    await act(async () =>
      root.render(
        <FigmaPasteImagesNotice
          count={
            new Set(
              Object.values(screens).flatMap((content) =>
                [...content.matchAll(/data-figma-image-ref="([^"]+)"/g)].map(
                  (match) => match[1],
                ),
              ),
            ).size
          }
          designId="design-1"
          fileIds={Object.keys(screens)}
          getScreenContent={(fileId) => screens[fileId] ?? ""}
          onConnect={vi.fn()}
          onDismissForever={vi.fn()}
          {...props}
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
    return props;
  }

  function buttonWithText(text: string) {
    return Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(text),
    );
  }

  async function chooseImageFile(button: HTMLButtonElement, file: File) {
    const input = container.querySelector<HTMLInputElement>(
      'input[accept="image/*,.svg"]',
    )!;
    vi.spyOn(input, "click").mockImplementation(() => mocks.dismissPopover());
    await act(async () => button.click());
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
  }

  it("fills the only missing image from an uploaded SVG and closes", async () => {
    mocks.callAction.mockResolvedValue({ resolved: 1, missing: 0 });
    const props = await renderNotice(missingImage("abc123", "Robot arm"));

    await chooseImageFile(
      buttonWithText("designEditor.import.figmaPasteUploadImage")!,
      new File(["<svg/>"], "robot.svg", { type: "image/svg+xml" }),
    );

    expect(props.uploadImage).toHaveBeenCalledWith(expect.any(File));
    expect(mocks.callAction).toHaveBeenCalledWith("fill-figma-paste-image", {
      fileId: "screen-1",
      hash: "abc123",
      imageUrl: "https://cdn.example.com/robot.svg",
    });
    expect(props.onHydrated).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("labels each missing image by layer name and stays open until all are filled", async () => {
    mocks.callAction.mockResolvedValue({ resolved: 1, missing: 1 });
    const props = await renderNotice(
      missingImage("h1", "Hero photo") + missingImage("h2", "Robot arm"),
    );

    const robotRow = buttonWithText('"name":"Robot arm"')!;
    expect(buttonWithText('"name":"Hero photo"')).toBeDefined();
    await chooseImageFile(
      robotRow,
      new File(["png"], "robot.png", { type: "image/png" }),
    );

    expect(mocks.callAction).toHaveBeenCalledWith(
      "fill-figma-paste-image",
      expect.objectContaining({ hash: "h2" }),
    );
    expect(props.onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('"count":1');
  });

  it("fills one image reused on two screens with a single upload", async () => {
    mocks.callAction.mockResolvedValue({ resolved: 1, missing: 0 });
    const props = await renderNotice({
      "screen-1": missingImage("shared", "Logo"),
      "screen-2": missingImage("shared", "Logo"),
    });

    expect(container.textContent).toContain('"count":1');
    await chooseImageFile(
      buttonWithText("designEditor.import.figmaPasteUploadImage")!,
      new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    );

    expect(props.uploadImage).toHaveBeenCalledTimes(1);
    expect(mocks.callAction.mock.calls).toEqual([
      [
        "fill-figma-paste-image",
        expect.objectContaining({ fileId: "screen-1", hash: "shared" }),
      ],
      [
        "fill-figma-paste-image",
        expect.objectContaining({ fileId: "screen-2", hash: "shared" }),
      ],
    ]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("retries a partly filled shared image with the same upload and refreshes after each write", async () => {
    mocks.callAction
      .mockResolvedValueOnce({ resolved: 1, missing: 0 })
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValue({ resolved: 1, missing: 0 });
    const props = await renderNotice({
      "screen-1": missingImage("shared", "Logo"),
      "screen-2": missingImage("shared", "Logo"),
    });

    await chooseImageFile(
      buttonWithText("designEditor.import.figmaPasteUploadImage")!,
      new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    );
    expect(props.onHydrated).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="designEditor.import.figmaHydrationDialogTitle"]',
        )!
        .click(),
    );
    const imageInput = container.querySelector<HTMLInputElement>(
      'input[accept="image/*,.svg"]',
    )!;
    const openChooser = vi.spyOn(imageInput, "click");
    openChooser.mockClear();
    await act(async () =>
      buttonWithText("designEditor.import.figmaPasteUploadImage")!.click(),
    );

    expect(openChooser).not.toHaveBeenCalled();
    expect(props.uploadImage).toHaveBeenCalledTimes(1);
    expect(
      mocks.callAction.mock.calls.map(([, args]) => [
        args.fileId,
        args.imageUrl,
      ]),
    ).toEqual([
      ["screen-1", "https://cdn.example.com/robot.svg"],
      ["screen-2", "https://cdn.example.com/robot.svg"],
      ["screen-2", "https://cdn.example.com/robot.svg"],
    ]);
    expect(props.onHydrated).toHaveBeenCalledTimes(2);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps filling other screens past a rejected one and retries only that screen", async () => {
    const rejection = (errorCode: string) =>
      Object.assign(new Error(errorCode), { errorCode });
    mocks.callAction
      .mockRejectedValueOnce(rejection("no_missing_images"))
      .mockRejectedValueOnce(rejection("placeholder_changed"))
      .mockResolvedValue({ resolved: 1, missing: 0 });
    const props = await renderNotice({
      "screen-1": missingImage("shared", "Logo"),
      "screen-2": missingImage("shared", "Logo"),
      "screen-3": missingImage("shared", "Logo"),
    });

    await chooseImageFile(
      buttonWithText("designEditor.import.figmaPasteUploadImage")!,
      new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    );
    expect(props.onHydrated).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="designEditor.import.figmaHydrationDialogTitle"]',
        )!
        .click(),
    );
    await act(async () =>
      buttonWithText("designEditor.import.figmaPasteUploadImage")!.click(),
    );

    expect(mocks.callAction.mock.calls.map(([, args]) => args.fileId)).toEqual([
      "screen-1",
      "screen-2",
      "screen-3",
      "screen-2",
    ]);
    expect(props.uploadImage).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not fill anything when the upload produced no URL", async () => {
    const props = await renderNotice(missingImage("abc123", "Robot arm"), {
      uploadImage: vi.fn(async () => ""),
    });

    await chooseImageFile(
      buttonWithText("designEditor.import.figmaPasteUploadImage")!,
      new File(["png"], "robot.png", { type: "image/png" }),
    );

    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("rejects non-image files before uploading", async () => {
    const props = await renderNotice(missingImage("abc123", "Robot arm"));

    await chooseImageFile(
      buttonWithText("designEditor.import.figmaPasteUploadImage")!,
      new File(["%PDF"], "brief.pdf", { type: "application/pdf" }),
    );

    expect(props.uploadImage).not.toHaveBeenCalled();
    expect(mocks.callAction).not.toHaveBeenCalled();
  });
});

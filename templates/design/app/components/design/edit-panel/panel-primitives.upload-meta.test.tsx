// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const uploadMeta = vi.hoisted(() => ({
  requirePersistedSourceAcceptance: true,
}));
const uploadState = vi.hoisted(() => ({
  onImageFillChange: undefined as
    | ((value: { url: string; fit: "fit" }, meta: object) => void)
    | undefined,
}));

vi.mock("../inspector", () => ({
  DesignColorPicker: ({
    onImageFillChange,
    uploadTargetKey,
  }: {
    onImageFillChange?: (
      value: { url: string; fit: "fit" },
      meta: object,
    ) => void;
    uploadTargetKey?: string;
  }) => {
    uploadState.onImageFillChange = onImageFillChange;
    return createElement(
      "button",
      {
        type: "button",
        "data-upload-target-key": uploadTargetKey,
        onClick: () =>
          onImageFillChange?.({ url: "/uploaded.png", fit: "fit" }, uploadMeta),
      },
      "Upload image",
    );
  },
  imageFillToBackgroundStyles: (value: { url: string; fit: string }) => ({
    backgroundImage: `url("${value.url}")`,
    backgroundSize: value.fit === "fit" ? "contain" : "cover",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  }),
}));

import { ColorInput } from "./panel-primitives";

let root: Root;
let container: HTMLDivElement;

function renderColorInput(
  onImageFillLayerChange: (...args: unknown[]) => void,
  sibling: {
    image: string;
    size: string;
    repeat: string;
    position: string;
  },
  targetPrefix = "file-a",
) {
  return act(() =>
    root.render(
      createElement(ColorInput, {
        label: "Fill",
        value: "#ffffff",
        onChange: vi.fn(),
        backgroundImage: sibling.image,
        backgroundSize: sibling.size,
        backgroundRepeat: sibling.repeat,
        backgroundPosition: sibling.position,
        onImageFillLayerChange,
        imageFillUploadTargetKeyForSelection: (selectedFillId) =>
          `${targetPrefix}:layer-selection:${selectedFillId}`,
        supportsLayeredFills: true,
      }),
    ),
  );
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  uploadState.onImageFillChange = undefined;
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe("ColorInput image upload metadata", () => {
  it("forwards metadata with a patch built from the latest sibling layers", () => {
    const onImageFillLayerChange = vi.fn();
    renderColorInput(onImageFillLayerChange, {
      image: 'url("old-sibling.png")',
      size: "cover",
      repeat: "no-repeat",
      position: "center",
    });
    renderColorInput(onImageFillLayerChange, {
      image: 'url("latest-sibling.png")',
      size: "contain",
      repeat: "repeat",
      position: "top left",
    });

    const uploadButton = container.querySelector<HTMLButtonElement>(
      "button[data-upload-target-key]",
    );
    expect(uploadButton?.getAttribute("data-upload-target-key")).toBe(
      "file-a:layer-selection:solid",
    );
    act(() => uploadButton?.click());

    expect(onImageFillLayerChange.mock.calls).toEqual([
      [
        {
          backgroundImage: 'url("/uploaded.png"), url("latest-sibling.png")',
          backgroundSize: "contain, contain",
          backgroundRepeat: "no-repeat, repeat",
          backgroundPosition: "center, top left",
        },
        uploadMeta,
      ],
    ]);
  });

  it("keeps a delayed upload callback bound to its original target", () => {
    const originalTargetChange = vi.fn();
    const currentTargetChange = vi.fn();
    renderColorInput(
      originalTargetChange,
      {
        image: 'url("original-sibling.png")',
        size: "cover",
        repeat: "no-repeat",
        position: "center",
      },
      "file-a",
    );
    const completeOriginalUpload = uploadState.onImageFillChange;
    expect(completeOriginalUpload).toBeTypeOf("function");

    renderColorInput(
      currentTargetChange,
      {
        image: 'url("new-target-sibling.png")',
        size: "contain",
        repeat: "repeat",
        position: "top left",
      },
      "file-b",
    );
    act(() =>
      completeOriginalUpload?.(
        { url: "/uploaded.png", fit: "fit" },
        uploadMeta,
      ),
    );

    expect(originalTargetChange.mock.calls).toEqual([
      [
        {
          backgroundImage: 'url("/uploaded.png"), url("original-sibling.png")',
          backgroundSize: "contain, cover",
          backgroundRepeat: "no-repeat, no-repeat",
          backgroundPosition: "center, center",
        },
        uploadMeta,
      ],
    ]);
    expect(currentTargetChange).not.toHaveBeenCalled();
  });
});

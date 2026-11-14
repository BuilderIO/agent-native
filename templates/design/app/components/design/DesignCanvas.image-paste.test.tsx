// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

import type { IframeImagePastePayload } from "./design-canvas/iframe-events";
import {
  MAX_IMAGE_PASTE_DATA_URL_CHARS,
  MAX_IMAGE_PASTE_FILES,
} from "./design-canvas/image-paste-files";
import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderCanvas(
  onImagePaste: (e: IframeImagePastePayload) => void,
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <DesignCanvas
          content="<!doctype html><html><body><h1>Inline</h1></body></html>"
          contentKey="screen-inline"
          screenId="screen-inline"
          onImagePaste={onImagePaste}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />
      </QueryClientProvider>,
    );
  });
  const iframeWindow = container.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  )?.contentWindow;
  if (!iframeWindow) throw new Error("preview iframe did not mount");
  return (files: unknown[]) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "canvas-image-paste", files },
          origin: "null",
          source: iframeWindow,
        }),
      );
    });
}

function pastedEvent(
  onImagePaste: Mock<(event: IframeImagePastePayload) => void>,
): IframeImagePastePayload {
  const call = onImagePaste.mock.lastCall;
  if (!call) throw new Error("onImagePaste was not called");
  return call[0];
}

const png = (name: string, payload = "AAAA") => ({
  dataUrl: `data:image/png;base64,${payload}`,
  type: "image/png",
  name,
});

describe("DesignCanvas canvas-image-paste", () => {
  it("hands over the first 20 files and says how many were left out", async () => {
    const onImagePaste = vi.fn<(event: IframeImagePastePayload) => void>();
    const paste = await renderCanvas(onImagePaste);
    await paste(
      Array.from({ length: MAX_IMAGE_PASTE_FILES + 3 }, (_, i) =>
        png(`${i}.png`),
      ),
    );
    expect(onImagePaste).toHaveBeenCalledTimes(1);
    const event = pastedEvent(onImagePaste);
    expect(event.files).toHaveLength(MAX_IMAGE_PASTE_FILES);
    expect(event.skipped).toEqual({ tooMany: 3, tooLarge: 0, invalid: 0 });
  });

  it("still reports the skips when every file was dropped", async () => {
    const onImagePaste = vi.fn<(event: IframeImagePastePayload) => void>();
    const paste = await renderCanvas(onImagePaste);
    await paste([png("huge.png", "A".repeat(MAX_IMAGE_PASTE_DATA_URL_CHARS))]);
    expect(onImagePaste).toHaveBeenCalledTimes(1);
    const event = pastedEvent(onImagePaste);
    expect(event.files).toEqual([]);
    expect(event.skipped).toEqual({ tooMany: 0, tooLarge: 1, invalid: 0 });
  });

  it("does not call back for an empty paste", async () => {
    const onImagePaste = vi.fn<(event: IframeImagePastePayload) => void>();
    const paste = await renderCanvas(onImagePaste);
    await paste([]);
    expect(onImagePaste).not.toHaveBeenCalled();
  });
});

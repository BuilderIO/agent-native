// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { OVERVIEW_LIVE_SCREEN_BUDGET } from "./multi-screen/culling";
import type { PreviewParseRequest } from "./multi-screen/preview-parse.worker";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: PreviewParseRequest[] = [];
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: PreviewParseRequest) {
    this.posted.push(request);
  }
  terminate() {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 2000,
    bottom: 1400,
    left: 0,
    width: 2000,
    height: 1400,
    toJSON: () => ({}),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  container.remove();
});

const nextFrames = () =>
  act(async () => {
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  });

it("mounts a static preview only once the worker has parsed its screen", async () => {
  const screens = Array.from(
    { length: OVERVIEW_LIVE_SCREEN_BUDGET + 1 },
    (_, index) => ({
      id: `inline-${index}`,
      filename: `inline-${index}.html`,
      content: `<!doctype html><html><body>inline ${index}</body></html>`,
    }),
  );
  await act(async () => {
    root.render(
      <MultiScreenCanvas
        screens={screens}
        zoom={10}
        activeTool="move"
        geometryById={Object.fromEntries(
          screens.map((screen, index) => [
            screen.id,
            { x: index * 1500, y: 0, width: 1440, height: 900 },
          ]),
        )}
        onPick={() => {}}
      />,
    );
  });
  const previewIds = () =>
    [...container.querySelectorAll("iframe[data-screen-static-preview]")].map(
      (iframe) => iframe.getAttribute("data-screen-iframe-id"),
    );

  await nextFrames();
  const posted = FakeWorker.instances.flatMap((worker) =>
    worker.posted.map((request) => ({ worker, request })),
  );
  expect(posted.length).toBeGreaterThan(0);
  expect(previewIds()).toEqual([]);

  const { worker, request: first } = posted[0]!;
  const parsedScreen = screens.find(
    (screen) => screen.content === first.content,
  )!;
  await act(async () => {
    worker.onmessage!({
      data: {
        kind: "preview",
        id: first.id,
        provenance: { versionHash: "worker", uniqueNodeIds: [] },
        runtimeSpans: [],
      },
    } as MessageEvent);
  });
  await nextFrames();

  expect(previewIds()).toEqual([parsedScreen.id]);
});

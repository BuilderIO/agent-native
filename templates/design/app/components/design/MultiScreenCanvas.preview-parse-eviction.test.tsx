// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

it("keeps a mounted static preview when its parse is evicted from the cache", async () => {
  const { createSourceDocumentProvenance } =
    await import("@shared/preview-source-provenance");
  const screens = Array.from(
    { length: OVERVIEW_LIVE_SCREEN_BUDGET + 1 },
    (_, index) => ({
      id: `inline-${index}`,
      filename: `inline-${index}.html`,
      content: `<!doctype html><html><body>evict ${index}<script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script></body></html>`,
    }),
  );
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MultiScreenCanvas
          screens={screens}
          zoom={10}
          creation={{ activeTool: "move" }}
          geometry={{
            geometryById: Object.fromEntries(
              screens.map((screen, index) => [
                screen.id,
                { x: index * 1500, y: 0, width: 1440, height: 900 },
              ]),
            ),
          }}
          onPick={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  const previewIds = () =>
    [...container.querySelectorAll("iframe[data-screen-static-preview]")].map(
      (iframe) => iframe.getAttribute("data-screen-iframe-id"),
    );
  const answer = async (worker: FakeWorker, request: PreviewParseRequest) =>
    act(async () => {
      worker.onmessage?.({
        data: {
          kind: "preview",
          id: request.id,
          provenance: { versionHash: "worker", uniqueNodeIds: [] },
          runtimeSpans: [],
        },
      } as MessageEvent);
    });

  await nextFrames();
  const [firstWorker, secondWorker] = FakeWorker.instances;
  expect(FakeWorker.instances.length).toBeGreaterThan(1);
  const first = firstWorker.posted[0];
  expect(first).toBeDefined();
  const parsedScreen = screens.find(
    (screen) => screen.content === first.content,
  );
  expect(parsedScreen).toBeDefined();
  await answer(firstWorker, first);
  await nextFrames();
  expect(previewIds()).toContain(parsedScreen?.id);

  for (let index = 0; index < 200; index += 1) {
    createSourceDocumentProvenance(`<p>filler ${index}</p>`);
  }
  const second = secondWorker.posted[0];
  expect(second).toBeDefined();
  await answer(secondWorker, second);
  await nextFrames();

  expect(previewIds()).toContain(parsedScreen?.id);
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

type Runtime = {
  start(): void;
  dispose(): Promise<void>;
  disposed: boolean;
  previewHostObserver: MutationObserver | null;
  previewHostResizeObserver: ResizeObserver | null;
};

let activeRuntime: Runtime | null = null;

function pageHide(persisted: boolean): PageTransitionEvent {
  const event = new PageTransitionEvent("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

afterEach(async () => {
  await activeRuntime?.dispose();
  activeRuntime = null;
  Reflect.deleteProperty(window, "__anNativeShaders");
  Reflect.deleteProperty(window, "frameElement");
  Reflect.deleteProperty(window, "parent");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("releases the parent preview-host listeners when its iframe leaves", async () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  Object.defineProperty(window, "frameElement", {
    configurable: true,
    value: frame,
  });
  const parent = new EventTarget() as Window;
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: parent,
  });
  const loading = vi
    .spyOn(document, "readyState", "get")
    .mockReturnValue("loading");
  await import("./native-shader-runtime.bridge");
  loading.mockRestore();

  const runtime = (window as unknown as { __anNativeShaders?: Runtime })
    .__anNativeShaders!;
  activeRuntime = runtime;
  const add = vi.spyOn(parent, "addEventListener");
  const remove = vi.spyOn(parent, "removeEventListener");
  runtime.start();

  const scroll = add.mock.calls.find(
    ([type, , capture]) => type === "scroll" && capture === true,
  )?.[1];
  const resize = add.mock.calls.find(([type]) => type === "resize")?.[1];
  expect(scroll).toBeTypeOf("function");
  expect(resize).toBeTypeOf("function");
  const mutationDisconnect = vi.spyOn(
    runtime.previewHostObserver!,
    "disconnect",
  );
  const resizeDisconnect = vi.spyOn(
    runtime.previewHostResizeObserver!,
    "disconnect",
  );

  window.dispatchEvent(pageHide(true));
  expect(runtime.disposed).toBe(false);
  expect(remove).not.toHaveBeenCalled();

  window.dispatchEvent(pageHide(false));

  expect(runtime.disposed).toBe(true);
  expect(remove).toHaveBeenCalledWith("scroll", scroll, true);
  expect(remove).toHaveBeenCalledWith("resize", resize);
  expect(mutationDisconnect).toHaveBeenCalled();
  expect(resizeDisconnect).toHaveBeenCalled();
  await runtime.dispose();
  window.dispatchEvent(pageHide(false));
  expect(remove.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(
    1,
  );
  expect(remove.mock.calls.filter(([type]) => type === "resize")).toHaveLength(
    1,
  );
});

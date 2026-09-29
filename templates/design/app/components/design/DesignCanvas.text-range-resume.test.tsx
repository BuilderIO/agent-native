// @vitest-environment happy-dom

import http, { type Server } from "node:http";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let panel: HTMLDivElement;
let root: Root;
let iframeServer: Server | null = null;

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
  panel = document.createElement("div");
  panel.setAttribute("data-design-chrome-region", "right-panel");
  document.body.append(container, panel);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  if (iframeServer) {
    await new Promise<void>((resolve) => iframeServer!.close(() => resolve()));
    iframeServer = null;
  }
  container.remove();
  panel.remove();
  document
    .querySelectorAll("[data-radix-popper-content-wrapper]")
    .forEach((node) => node.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountCanvasWithStyledRange(active = true) {
  iframeServer = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>Runtime</body></html>");
  });
  const iframePort = await new Promise<number>((resolve, reject) => {
    iframeServer!.once("error", reject);
    iframeServer!.listen(0, "127.0.0.1", () => {
      const address = iframeServer!.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  const bridgeUrl = `http://127.0.0.1:${iframePort}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
  await act(async () => {
    root.render(
      <DesignCanvas
        content="http://localhost:5173/"
        contentKey="screen-live"
        screenId="screen-live"
        sourceType="localhost"
        bridgeUrl={bridgeUrl}
        previewToken="text-range-resume-token"
        liveEditCapability="text-range-resume-live-capability"
        liveEditRegistrationCapability="text-range-resume-registration-capability"
        zoom={100}
        deviceFrame="none"
        editMode
        interactMode={false}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />,
    );
  });
  await vi.waitFor(() => {
    expect(
      container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      )?.src,
    ).toContain("/live-edit?");
  });
  const iframe = container.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  )!;
  const iframeWindow = iframe.contentWindow as Window;
  const posted: Array<{ type?: string }> = [];
  iframeWindow.postMessage = ((message: { type?: string }) => {
    posted.push(message);
  }) as Window["postMessage"];
  const fromFrame = async (data: unknown) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
  };
  await fromFrame({
    type: "agent-native:runtime-layer-snapshot",
    payload: { html: "<body></body>", nodeCount: 1 },
  });
  await fromFrame({ type: "agent-native:editor-chrome-ready" });
  await fromFrame({
    type: "text-editing-state",
    active,
    selector: "#hero",
    sourceId: "hero",
    hasRange: true,
  });
  const resumes = () =>
    posted.filter((message) => message.type === "resume-text-edit");
  return { resumes };
}

const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

it("returns the keyboard to a styled text range when an inspector select closes", async () => {
  const { resumes } = await mountCanvasWithStyledRange();
  const trigger = document.createElement("button");
  panel.appendChild(trigger);
  const popper = document.createElement("div");
  popper.setAttribute("data-radix-popper-content-wrapper", "");
  const option = document.createElement("div");
  option.setAttribute("role", "option");
  option.tabIndex = -1;
  popper.appendChild(option);
  document.body.appendChild(popper);

  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.focus();
    option.focus();
  });
  await nextFrame();
  expect(resumes()).toHaveLength(0);

  await act(async () => {
    popper.remove();
    trigger.focus();
  });
  await nextFrame();
  expect(resumes()).toEqual([
    expect.objectContaining({
      type: "resume-text-edit",
      screenId: "screen-live",
      selector: "#hero",
      sourceId: "hero",
    }),
  ]);
});

it("does not resume the text edit when an inspector trigger is only being opened", async () => {
  const { resumes } = await mountCanvasWithStyledRange();
  const trigger = document.createElement("button");
  panel.appendChild(trigger);
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    trigger.focus();
  });
  await nextFrame();
  expect(resumes()).toHaveLength(0);
});

it("keeps focus in an open picker when the pointer moves over the canvas", async () => {
  await mountCanvasWithStyledRange(false);
  const iframe = container.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  )!;
  let surface: HTMLElement | null = iframe.parentElement;
  while (surface && surface.getAttribute("tabindex") !== "-1")
    surface = surface.parentElement;
  expect(surface).not.toBeNull();
  const popper = document.createElement("div");
  popper.setAttribute("data-radix-popper-content-wrapper", "");
  const field = document.createElement("div");
  field.tabIndex = 0;
  popper.appendChild(field);
  document.body.appendChild(popper);
  field.focus();

  await act(async () => {
    surface!.dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, relatedTarget: field }),
    );
    surface!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: field }),
    );
  });
  expect(document.activeElement).toBe(field);
});

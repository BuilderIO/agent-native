// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";
import { act } from "react";
import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";
import { replaceLinkedScreenPreviewContent } from "./multi-screen/linked-screen-preview";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

const parse5Parse = vi.hoisted(() => ({ calls: 0 }));
vi.mock("parse5", async (importOriginal) => {
  const parse5 = await importOriginal<typeof import("parse5")>();
  return {
    ...parse5,
    parse: (...args: Parameters<typeof parse5.parse>) => {
      parse5Parse.calls += 1;
      return parse5.parse(...args);
    },
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const documentWith = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body data-agent-native-node-id="an-body">${body}</body></html>`;

const BODY = '<main data-agent-native-node-id="an-main"><p>hi</p></main>';
const BASE = documentWith("<title>Screen</title>", BODY);

type VisualStyleBatchHandler = ComponentProps<
  typeof DesignCanvas
>["onVisualStyleBatchChange"];

async function renderCanvas(
  content: string,
  authoredSourceContent?: string,
  onVisualStyleBatchChange?: VisualStyleBatchHandler,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = (next: string, authored?: string) => (
    <DesignCanvas
      content={next}
      authoredSourceContent={authored}
      contentKey="screen:inline-overview"
      runtimeReplacementContent={next}
      runtimeReplacementKey="screen:inline-overview"
      screenId="screen"
      zoom={100}
      deviceFrame="none"
      interactMode={false}
      onElementSelect={() => {}}
      onElementHover={() => {}}
      onVisualStyleBatchChange={onVisualStyleBatchChange}
      tweakValues={{}}
      editMode
    />
  );
  await act(async () => root.render(view(content, authoredSourceContent)));
  const iframe = () =>
    container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
  return {
    iframe,
    update: async (next: string, authored?: string) =>
      act(async () => root.render(view(next, authored))),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("DesignCanvas runtime replacement", () => {
  it("keeps the initial authored proof paired with srcdoc and sends new raw proof with replacement", async () => {
    const wrapped = BASE.replace("<body ", '<body data-preview-wrapper="yes" ');
    const canvas = await renderCanvas(wrapped, BASE);
    try {
      const frame = canvas.iframe()!;
      const initialSrcdoc = frame.srcdoc;
      expect(initialSrcdoc).toContain(
        JSON.stringify(createSourceDocumentProvenance(BASE)),
      );
      const sent: any[] = [];
      frame.contentWindow!.postMessage = ((message: unknown) =>
        sent.push(message)) as Window["postMessage"];
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow as unknown as Window,
            data: { type: "editor-chrome-ready" },
          }),
        ),
      );
      const next = BASE.replace(
        "<p>hi</p>",
        "<p>updated source</p><p>new sibling</p>",
      );
      await canvas.update(
        next.replace("<body ", '<body data-preview-wrapper="yes" '),
        next,
      );
      expect(canvas.iframe()).toBe(frame);
      expect(frame.srcdoc).toBe(initialSrcdoc);
      const replacement = sent
        .reverse()
        .find((message) => message.type === "replace-document-content");
      expect(replacement?.sourceProvenance).toEqual(
        createSourceDocumentProvenance(next),
      );
      expect(replacement?.content).toContain('data-preview-wrapper="yes"');
    } finally {
      await canvas.cleanup();
    }
  });

  it("does not rebuild srcdoc when only the source head changed", async () => {
    const canvas = await renderCanvas(BASE);
    try {
      const before = canvas.iframe()?.srcdoc;
      expect(before).toBeTruthy();

      await canvas.update(
        documentWith(
          "<title>Screen</title><style data-agent-native-breakpoints>@media (max-width:640px){p{display:none}}</style>",
          BODY,
        ),
      );

      expect(canvas.iframe()?.srcdoc).toBe(before);
    } finally {
      await canvas.cleanup();
    }
  });

  it("still rebuilds srcdoc when a source script changed", async () => {
    const canvas = await renderCanvas(BASE);
    try {
      const before = canvas.iframe()?.srcdoc;

      await canvas.update(
        documentWith(
          "<title>Screen</title><script>window.__x = 1;</script>",
          BODY,
        ),
      );

      expect(canvas.iframe()?.srcdoc).not.toBe(before);
    } finally {
      await canvas.cleanup();
    }
  });
  it("rebuilds srcdoc when a source script moves between head and body", async () => {
    const script = "<script>window.__x = 1;</script>";
    const canvas = await renderCanvas(
      documentWith(`<title>Screen</title>${script}`, BODY),
    );
    try {
      const before = canvas.iframe()?.srcdoc;

      await canvas.update(
        documentWith("<title>Screen</title>", `${BODY}${script}`),
      );

      expect(canvas.iframe()?.srcdoc).not.toBe(before);
    } finally {
      await canvas.cleanup();
    }
  });

  it("cancels refused and malformed K batches before replacing the source", async () => {
    const validChanges = [
      {
        selector: '[data-agent-native-node-id="an-main"]',
        sourceId: "an-main",
        elementInfo: {
          tagName: "main",
          sourceId: "an-main",
          selector: '[data-agent-native-node-id="an-main"]',
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 100, height: 80 },
          isFlexChild: false,
          isFlexContainer: false,
        },
        styles: { width: "90px" },
        originalStyles: { width: "60px" },
        preserveSelection: true,
      },
    ];
    const cases: Array<{
      label: string;
      changes: unknown;
      expectCallback: boolean;
    }> = [
      {
        label: "refused valid batch",
        changes: validChanges,
        expectCallback: true,
      },
      {
        label: "malformed batch",
        changes: [{ ...validChanges[0], selector: 7 }],
        expectCallback: false,
      },
    ];

    for (const { label, changes, expectCallback } of cases) {
      const order: string[] = [];
      const receivedBatches: unknown[] = [];
      const onVisualStyleBatchChange = vi.fn((received: unknown) => {
        receivedBatches.push(received);
        return false;
      });
      const canvas = await renderCanvas(
        BASE,
        undefined,
        onVisualStyleBatchChange,
      );
      try {
        const frameWindow = canvas.iframe()!.contentWindow!;
        frameWindow.postMessage = ((message: unknown) => {
          if (
            message &&
            typeof message === "object" &&
            typeof (message as { type?: unknown }).type === "string"
          ) {
            order.push((message as { type: string }).type);
          }
        }) as Window["postMessage"];
        Object.defineProperty(frameWindow, "__designCanvasScaleContents", {
          configurable: true,
          value: (_factor: number, phase: string) => {
            order.push(`scale:${phase}`);
            return [];
          },
        });
        await act(async () =>
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: window.location.origin,
              source: frameWindow,
              data: { type: "editor-chrome-ready" },
            }),
          ),
        );
        order.length = 0;

        await act(async () =>
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: window.location.origin,
              source: frameWindow,
              data: { type: "visual-style-batch-change", changes },
            }),
          ),
        );

        if (expectCallback) {
          expect(onVisualStyleBatchChange, label).toHaveBeenCalledOnce();
          expect(receivedBatches[0]).toMatchObject([
            { elementInfo: { sourceId: "an-main" } },
          ]);
        } else {
          expect(onVisualStyleBatchChange, label).not.toHaveBeenCalled();
        }
        expect(order, label).toEqual([
          "scale:cancel",
          "replace-document-content",
        ]);
      } finally {
        await canvas.cleanup();
      }
    }
  });

  it("continues after a cross-origin cancel SecurityError but rethrows other failures", async () => {
    const changes = [
      {
        selector: '[data-agent-native-node-id="an-main"]',
        sourceId: "an-main",
        styles: { width: "90px" },
        originalStyles: { width: "60px" },
      },
    ];
    const dispatchBatch = async (frameWindow: Window) =>
      act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            source: frameWindow,
            data: { type: "visual-style-batch-change", changes },
          }),
        ),
      );
    const installReadyAndCapture = async (
      frameWindow: Window,
      order: string[],
    ) => {
      frameWindow.postMessage = ((message: unknown) => {
        if (
          message &&
          typeof message === "object" &&
          typeof (message as { type?: unknown }).type === "string"
        ) {
          order.push((message as { type: string }).type);
        }
      }) as Window["postMessage"];
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: window.location.origin,
            source: frameWindow,
            data: { type: "editor-chrome-ready" },
          }),
        ),
      );
      order.length = 0;
    };

    const securityOrder: string[] = [];
    const securityCanvas = await renderCanvas(BASE, undefined, () => false);
    try {
      const frameWindow = securityCanvas.iframe()!.contentWindow!;
      await installReadyAndCapture(frameWindow, securityOrder);
      Object.defineProperty(frameWindow, "__designCanvasScaleContents", {
        configurable: true,
        get() {
          throw new DOMException(
            "Blocked cross-origin access",
            "SecurityError",
          );
        },
      });

      await dispatchBatch(frameWindow);

      expect(securityOrder).toEqual(["replace-document-content"]);
    } finally {
      await securityCanvas.cleanup();
    }

    const unexpected = new Error("unexpected cancel failure");
    const unexpectedOrder: string[] = [];
    const unexpectedCanvas = await renderCanvas(BASE, undefined, () => false);
    try {
      const frameWindow = unexpectedCanvas.iframe()!.contentWindow!;
      await installReadyAndCapture(frameWindow, unexpectedOrder);
      Object.defineProperty(frameWindow, "__designCanvasScaleContents", {
        configurable: true,
        get() {
          throw unexpected;
        },
      });

      await expect(dispatchBatch(frameWindow)).rejects.toBe(unexpected);

      expect(unexpectedOrder).not.toContain("replace-document-content");
    } finally {
      await unexpectedCanvas.cleanup();
    }
  });
});

describe("DesignCanvas host replacement of a runtime-replaced screen", () => {
  async function readyCanvasCapturing() {
    const canvas = await renderCanvas(BASE);
    const frame = canvas.iframe()!;
    const sent: { type: string; [key: string]: unknown }[] = [];
    frame.contentWindow!.postMessage = ((message: never) =>
      sent.push(message)) as Window["postMessage"];
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow as unknown as Window,
          data: { type: "editor-chrome-ready" },
        }),
      ),
    );
    buildCodeLayerProjection(BASE, {
      source: { kind: "design-file", fileId: "screen" },
    });
    sent.length = 0;
    return { canvas, sent };
  }

  it("swaps only the edited node when an undo changes one text run", async () => {
    const { canvas, sent } = await readyCanvasCapturing();
    try {
      const next = BASE.replace("<p>hi</p>", "<p>bye</p>");

      expect(
        replaceLinkedScreenPreviewContent("screen", next, null, [], {
          forceFullDocument: true,
          allowSourceNodeSwap: true,
        }),
      ).toBe(true);

      expect(sent.map((message) => message.type)).toEqual([
        "replace-source-node",
      ]);
      expect(sent[0]).toMatchObject({
        nodeId: "an-main",
        html: '<main data-agent-native-node-id="an-main"><p>bye</p></main>',
        sourceProvenance: createSourceDocumentProvenance(next),
      });
    } finally {
      await canvas.cleanup();
    }
  });

  it("derives an undo's provenance without re-parsing after the cache dropped the edited document", async () => {
    const { canvas, sent } = await readyCanvasCapturing();
    try {
      const expected = structuredClone(createSourceDocumentProvenance(BASE));
      const edited = BASE.replace("<p>hi</p>", "<p>bye</p>");
      buildCodeLayerProjection(edited, {
        source: { kind: "design-file", fileId: "screen" },
      });
      replaceLinkedScreenPreviewContent("screen", edited, null, [], {
        forceFullDocument: true,
        allowSourceNodeSwap: true,
      });
      for (const filler of ["x", "y"]) {
        createSourceDocumentProvenance.prime(filler.repeat(13_000_000), {
          versionHash: "",
          uniqueNodeIds: [],
        });
      }
      expect(createSourceDocumentProvenance.has(edited)).toBe(false);
      expect(createSourceDocumentProvenance.has(BASE)).toBe(false);
      const parsesBeforeUndo = parse5Parse.calls;

      replaceLinkedScreenPreviewContent("screen", BASE, null, [], {
        forceFullDocument: true,
        allowSourceNodeSwap: true,
      });

      expect(parse5Parse.calls).toBe(parsesBeforeUndo);
      expect(sent.map((message) => message.type)).toEqual([
        "replace-source-node",
        "replace-source-node",
      ]);
      expect(sent[1]!.sourceProvenance).toEqual(expected);
    } finally {
      await canvas.cleanup();
    }
  });

  it("diffs an undo against a design-state preview, not the content before it", async () => {
    const { canvas, sent } = await readyCanvasCapturing();
    try {
      const statePreview = BASE.replace("<p>hi</p>", "<p>hi</p><p>hover</p>");
      replaceLinkedScreenPreviewContent("screen", statePreview, null, [], {
        forceFullDocument: true,
      });

      replaceLinkedScreenPreviewContent(
        "screen",
        BASE.replace("<p>hi</p>", "<p>bye</p>"),
        null,
        [],
        { forceFullDocument: true, allowSourceNodeSwap: true },
      );

      expect(sent.map((message) => message.type)).toEqual([
        "replace-document-content",
        "replace-document-content",
      ]);
    } finally {
      await canvas.cleanup();
    }
  });

  it("still sends the whole document when the undo changes structure", async () => {
    const { canvas, sent } = await readyCanvasCapturing();
    try {
      const next = BASE.replace("<p>hi</p>", "<p>hi</p><p>restored</p>");

      replaceLinkedScreenPreviewContent("screen", next, null, [], {
        forceFullDocument: true,
        allowSourceNodeSwap: true,
      });

      expect(sent.map((message) => message.type)).toEqual([
        "replace-document-content",
      ]);
      expect(sent[0]).toMatchObject({ forceFullDocument: true });
    } finally {
      await canvas.cleanup();
    }
  });

  it("rebuilds the whole document for a forced resync that changed one text run", async () => {
    const { canvas, sent } = await readyCanvasCapturing();
    try {
      const next = BASE.replace("<p>hi</p>", "<p>from a collaborator</p>");

      replaceLinkedScreenPreviewContent("screen", next, null, [], {
        forceFullDocument: true,
      });

      expect(sent.map((message) => message.type)).toEqual([
        "replace-document-content",
      ]);
      expect(sent[0]).toMatchObject({ forceFullDocument: true });
    } finally {
      await canvas.cleanup();
    }
  });

  it("falls back to the whole document with the undo's own selection when the frame rejects the swap", async () => {
    const { canvas, sent } = await readyCanvasCapturing();
    try {
      const next = BASE.replace("<p>hi</p>", "<p>bye</p>");
      const selector = '[data-agent-native-node-id="an-main"]';
      replaceLinkedScreenPreviewContent(
        "screen",
        next,
        selector,
        [selector, "main"],
        { forceFullDocument: true, allowSourceNodeSwap: true },
      );
      expect(sent.map((message) => message.type)).toEqual([
        "replace-source-node",
      ]);

      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: canvas.iframe()!.contentWindow as unknown as Window,
            origin: window.location.origin,
            data: { type: "replace-source-node-rejected" },
          }),
        ),
      );

      expect(sent.map((message) => message.type)).toEqual([
        "replace-source-node",
        "replace-document-content",
      ]);
      expect(sent[1]).toMatchObject({
        selectedSelector: selector,
        selectorCandidates: [selector, "main"],
        forceFullDocument: true,
        preserveTextEditingSession: false,
        sourceProvenance: createSourceDocumentProvenance(next),
      });
    } finally {
      await canvas.cleanup();
    }
  });
});

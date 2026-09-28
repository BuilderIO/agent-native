// @vitest-environment happy-dom
//
// Narrow hypothesis: structural edits (drag-into-container, undo, alt-drag
// out, delete+undo) on a document that carries a Tailwind Play CDN script +
// inline `tailwind.config` + Alpine CDN script + inline theme script trigger
// `runtimeDocumentNeedsReload` (DesignCanvas.tsx ~1078) even though no
// *script* text actually changed — because `applyVisualEdit` re-serializes
// bytes it shouldn't. Reuses the `renderCanvas` harness from
// DesignCanvas.head-edit-no-reload.test.tsx: a stable `iframe.srcdoc`
// reference across an update means `runtimeDocumentNeedsReload` returned
// false (in-place morph); a new one means it returned true (full reload,
// the observed "flash").

import { applyVisualEdit } from "@shared/code-layer";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HEAD = [
  '<script src="https://cdn.tailwindcss.com"></script>',
  "<script>tailwind.config = { darkMode: 'class' };</script>",
  '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js" defer></script>',
  "<script>if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) { document.documentElement.classList.add('dark'); }</script>",
  "<title>Screen</title>",
].join("\n");

const BODY =
  '<body data-agent-native-node-id="an-body" class="dark bg-white dark:bg-black">' +
  '<main data-agent-native-node-id="an-main">' +
  '<div data-agent-native-node-id="hero"><p>Hero</p></div>' +
  '<div data-agent-native-node-id="card"><p>Card</p></div>' +
  '<footer data-agent-native-node-id="footer"></footer>' +
  "</main></body>";

const BASE = `<!doctype html><html><head>${HEAD}</head>${BODY}</html>`;

function apply(html: string, intent: Parameters<typeof applyVisualEdit>[1]) {
  const patch = applyVisualEdit(html, intent);
  expect(patch.result.status, JSON.stringify(patch.result)).toBe("applied");
  return patch.content;
}

async function renderCanvas(content: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const view = (next: string) => (
    <DesignCanvas
      content={next}
      contentKey="screen:inline-overview"
      runtimeReplacementContent={next}
      runtimeReplacementKey={`screen:${next.length}:${next.slice(-24)}`}
      screenId="screen"
      zoom={100}
      deviceFrame="none"
      interactMode={false}
      onElementSelect={() => {}}
      onElementHover={() => {}}
      tweakValues={{}}
      editMode
    />
  );
  await act(async () => root.render(view(content)));
  const iframe = () =>
    container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
  return {
    iframe,
    update: async (next: string) => act(async () => root.render(view(next))),
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("runtimeDocumentNeedsReload with a script-bearing document", () => {
  it("does not reload on drag-into-container, undo, undo again", async () => {
    const canvas = await renderCanvas(BASE);
    try {
      const base = canvas.iframe()?.srcdoc;
      expect(base).toBeTruthy();

      const afterDrag = apply(BASE, {
        kind: "moveNode",
        target: { nodeId: "hero" },
        anchor: { nodeId: "footer" },
        placement: "inside",
      });
      await canvas.update(afterDrag);
      expect(
        canvas.iframe()?.srcdoc,
        "drag-into-container spuriously reloaded the frame",
      ).toBe(base);

      await canvas.update(BASE);
      expect(
        canvas.iframe()?.srcdoc,
        "undo spuriously reloaded the frame",
      ).toBe(base);

      await canvas.update(BASE);
      expect(
        canvas.iframe()?.srcdoc,
        "second undo spuriously reloaded the frame",
      ).toBe(base);
    } finally {
      await canvas.cleanup();
    }
  });

  it("does not reload on alt-drag out of the screen, then undo", async () => {
    const canvas = await renderCanvas(BASE);
    try {
      const base = canvas.iframe()?.srcdoc;

      const afterAltDrag = apply(BASE, {
        kind: "moveNode",
        target: { nodeId: "card" },
        anchor: { nodeId: "an-main" },
        placement: "after",
      });
      await canvas.update(afterAltDrag);
      expect(
        canvas.iframe()?.srcdoc,
        "alt-drag-out spuriously reloaded the frame",
      ).toBe(base);

      await canvas.update(BASE);
      expect(
        canvas.iframe()?.srcdoc,
        "undo after alt-drag-out spuriously reloaded the frame",
      ).toBe(base);
    } finally {
      await canvas.cleanup();
    }
  });

  it("does not reload on delete, then undo", async () => {
    const canvas = await renderCanvas(BASE);
    try {
      const base = canvas.iframe()?.srcdoc;

      const afterDelete = apply(BASE, {
        kind: "deleteNode",
        target: { nodeId: "card" },
      });
      await canvas.update(afterDelete);
      expect(
        canvas.iframe()?.srcdoc,
        "delete spuriously reloaded the frame",
      ).toBe(base);

      await canvas.update(BASE);
      expect(
        canvas.iframe()?.srcdoc,
        "undo after delete spuriously reloaded the frame",
      ).toBe(base);
    } finally {
      await canvas.cleanup();
    }
  });

  it("does not reload on group-wrap (Cmd+G) of a node, then undo", async () => {
    const canvas = await renderCanvas(BASE);
    try {
      const base = canvas.iframe()?.srcdoc;

      const afterWrap = apply(BASE, {
        kind: "wrapNodes",
        targetIds: ["card"],
      });
      await canvas.update(afterWrap);
      expect(
        canvas.iframe()?.srcdoc,
        "group-wrap spuriously reloaded the frame",
      ).toBe(base);

      await canvas.update(BASE);
      expect(
        canvas.iframe()?.srcdoc,
        "undo after group-wrap spuriously reloaded the frame",
      ).toBe(base);
    } finally {
      await canvas.cleanup();
    }
  });

  it("does not reload when the next content reserializes a bare boolean script attribute", async () => {
    const reserialized = BASE.replace(
      '/dist/cdn.min.js" defer>',
      '/dist/cdn.min.js" defer="">',
    );
    expect(reserialized).not.toBe(BASE);
    const canvas = await renderCanvas(BASE);
    try {
      const base = canvas.iframe()?.srcdoc;
      expect(base).toBeTruthy();
      await canvas.update(reserialized);
      expect(
        canvas.iframe()?.srcdoc,
        'a defer -> defer="" reserialization must not force a full reload',
      ).toBe(base);
    } finally {
      await canvas.cleanup();
    }
  });

  it("byte-for-byte: the <head> script region never changes across any structural edit", () => {
    const headOf = (html: string) => html.slice(0, html.search(/<\/head\s*>/i));

    const afterDrag = apply(BASE, {
      kind: "moveNode",
      target: { nodeId: "hero" },
      anchor: { nodeId: "footer" },
      placement: "inside",
    });
    const afterAltDrag = apply(BASE, {
      kind: "moveNode",
      target: { nodeId: "card" },
      anchor: { nodeId: "an-main" },
      placement: "after",
    });
    const afterDelete = apply(BASE, {
      kind: "deleteNode",
      target: { nodeId: "card" },
    });
    const afterWrap = apply(BASE, { kind: "wrapNodes", targetIds: ["card"] });

    const baseHead = headOf(BASE);
    for (const [label, variant] of [
      ["drag-into-container", afterDrag],
      ["alt-drag-out", afterAltDrag],
      ["delete", afterDelete],
      ["group-wrap", afterWrap],
    ] as const) {
      expect(headOf(variant), `${label} changed the <head> byte-for-byte`).toBe(
        baseHead,
      );
    }
  });
});

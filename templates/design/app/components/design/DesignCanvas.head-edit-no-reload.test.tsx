// @vitest-environment happy-dom

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

const documentWith = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body data-agent-native-node-id="an-body">${body}</body></html>`;

const BODY = '<main data-agent-native-node-id="an-main"><p>hi</p></main>';
const BASE = documentWith("<title>Screen</title>", BODY);

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

describe("DesignCanvas runtime replacement", () => {
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

      // A rebuilt srcdoc reloads the iframe, re-executing the bridge, Tailwind
      // and Alpine. Managed breakpoint/motion/token CSS lives in the head, so
      // gating a reload on head equality reloaded the frame on every one.
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

      // Identical script text in a new region: the morph would strip it from
      // the head and import an inert copy into the body that never executes.
      expect(canvas.iframe()?.srcdoc).not.toBe(before);
    } finally {
      await canvas.cleanup();
    }
  });
});

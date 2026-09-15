// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";
import { SCALED_IFRAME_PAINT_RETENTION_STYLE } from "./scaled-iframe-paint";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** Every source file that paints an iframe under a shrinking transform. A
 *  scaled iframe outside this list is unguarded, so a new preview surface
 *  belongs here at the same time it is written. */
const SCALED_IFRAME_SOURCES = [
  "app/components/design/DesignCanvas.tsx",
  "app/components/design/DesignThumbnail.tsx",
  "app/components/design/MultiScreenCanvas.tsx",
  "app/components/templates/TemplatePreview.tsx",
];

/** Each `<iframe … />` element in a source file, as raw text. Every canvas
 *  iframe in these files is self-closing and no attribute value contains
 *  `/>`, so the first one after the tag opener ends the element. */
function iframeElements(source: string): string[] {
  return source
    .split("<iframe")
    .slice(1)
    .map((rest) => {
      const end = rest.indexOf("/>");
      expect(end).toBeGreaterThan(-1);
      return rest.slice(0, end);
    });
}

async function renderEmbeddedDesignCanvas() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <DesignCanvas
        content="<!doctype html><html><body><div>VERDE</div></body></html>"
        contentKey="overview-screen"
        screenId="screen-1"
        zoom={29}
        deviceFrame="none"
        interactMode={false}
        editMode
        registerRuntimeBridge={false}
        embeddedFrame={{
          viewportWidth: 1280,
          viewportHeight: 6400,
          displayWidth: 1280,
          displayHeight: 6400,
          fluid: true,
        }}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />,
    ),
  );
  return {
    container,
    cleanup: () => {
      root.unmount();
      container.remove();
    },
  };
}

describe("canvas iframe paint retention", () => {
  it("keeps the overview screen iframe composited at fractional scale", async () => {
    const { container, cleanup } = await renderEmbeddedDesignCanvas();
    try {
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe).not.toBeNull();
      // Without this the child browsing context's backing store is dropped
      // once an ancestor scale shrinks it far enough, and a fully-loaded
      // screen paints as a blank white or solid black frame.
      expect(iframe!.style.backfaceVisibility).toBe("hidden");
    } finally {
      cleanup();
    }
  });

  it("gives every scaled iframe the shared declaration or a named opt-out", () => {
    // The declaration was inlined at two render sites and missed everywhere
    // that mattered — the editor's own screen iframe, the low-zoom board
    // preview, and both card previews — so the diagnosed bug stayed live. A
    // new site now has to make the choice explicitly instead of inheriting
    // the omission.
    for (const path of SCALED_IFRAME_SOURCES) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("backfaceVisibility:");
      const elements = iframeElements(source);
      expect(elements.length).toBeGreaterThan(0);
      for (const element of elements) {
        const painted = element.includes(
          "...SCALED_IFRAME_PAINT_RETENTION_STYLE,",
        );
        const optedOut = element.includes("scaled-iframe-paint-ignore");
        expect(
          painted || optedOut,
          `${path}: <iframe${element.slice(0, 120)}`,
        ).toBe(true);
        expect(painted && optedOut).toBe(false);
      }
    }
  });

  it("opts out only iframes that are never painted on the canvas", () => {
    for (const path of SCALED_IFRAME_SOURCES) {
      for (const element of iframeElements(readFileSync(path, "utf8"))) {
        if (!element.includes("scaled-iframe-paint-ignore")) continue;
        // An opted-out iframe has to be genuinely offscreen. One that is only
        // transparent or aria-hidden still occupies canvas space and still
        // reads as a blank frame when its backing store is dropped.
        expect(element).toContain("opacity-0");
        expect(element).toContain("-100_000");
      }
    }
  });

  it("stays transform-free so a site with its own scale can spread it", () => {
    expect(SCALED_IFRAME_PAINT_RETENTION_STYLE).not.toHaveProperty("transform");
    expect(SCALED_IFRAME_PAINT_RETENTION_STYLE.backfaceVisibility).toBe(
      "hidden",
    );
  });
});

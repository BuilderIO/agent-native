// @vitest-environment happy-dom

import { readFileSync } from "node:fs";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";
import {
  getIframePaintRetentionStyle,
  MAX_RETAINED_IFRAME_PAINT_AXIS_PX,
  SCALED_IFRAME_PAINT_RETENTION_STYLE,
} from "./scaled-iframe-paint";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SCALED_IFRAME_SOURCES = [
  "app/components/design/DesignCanvas.tsx",
  "app/components/design/DesignThumbnail.tsx",
  "app/components/design/MultiScreenCanvas.tsx",
  "app/components/templates/TemplatePreview.tsx",
];

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

async function renderEmbeddedDesignCanvas({
  viewportWidth = 1280,
  viewportHeight = 900,
  displayWidth = viewportWidth,
  displayHeight = viewportHeight,
  fluid = true,
  zoom = 100,
  effectiveScale = 0.29,
  effectiveScaleY = effectiveScale,
  embeddedFrame,
}: {
  viewportWidth?: number;
  viewportHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  fluid?: boolean;
  zoom?: number;
  effectiveScale?: number;
  effectiveScaleY?: number;
  embeddedFrame?: {
    viewportWidth: number;
    viewportHeight: number;
    displayWidth: number;
    displayHeight: number;
    fluid?: boolean;
  };
} = {}) {
  const resolvedEmbeddedFrame = embeddedFrame ?? {
    viewportWidth,
    viewportHeight,
    displayWidth,
    displayHeight,
    fluid,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <DesignCanvas
        content="<!doctype html><html><body><div>VERDE</div></body></html>"
        contentKey="overview-screen"
        screenId="screen-1"
        zoom={zoom}
        editorChromeScaleX={effectiveScale}
        editorChromeScaleY={effectiveScaleY}
        deviceFrame="none"
        interactMode={false}
        editMode
        registerRuntimeBridge={false}
        embeddedFrame={resolvedEmbeddedFrame}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />,
    ),
  );
  return {
    container,
    cleanup: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("canvas iframe paint retention", () => {
  it.each([0.02, 0.04, 0.29])(
    "keeps retention on a small embedded iframe at scale %s",
    async (effectiveScale) => {
      const { container, cleanup } = await renderEmbeddedDesignCanvas({
        effectiveScale,
      });
      try {
        const iframe = container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        expect(iframe).not.toBeNull();
        expect(iframe!.style.backfaceVisibility).toBe("hidden");
        expect(iframe!.style.transform).toBe("");
      } finally {
        await cleanup();
      }
    },
  );

  it.each([
    { viewportHeight: 32_000, effectiveScale: 0.02 },
    { viewportHeight: 32_000, effectiveScale: 0.04 },
    { viewportHeight: 42_000, effectiveScale: 0.02 },
    { viewportHeight: 42_000, effectiveScale: 0.04 },
  ])(
    "disables retention on a $viewportHeight px embedded iframe at scale $effectiveScale",
    async ({ viewportHeight, effectiveScale }) => {
      const { container, cleanup } = await renderEmbeddedDesignCanvas({
        viewportHeight,
        effectiveScale,
      });
      try {
        const iframe = container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        expect(iframe).not.toBeNull();
        expect(iframe!.style.backfaceVisibility).toBe("visible");
        expect(iframe!.style.transform).toBe("");
      } finally {
        await cleanup();
      }
    },
  );

  it.each([
    { displayWidth: 6000, displayHeight: 900 },
    { displayWidth: 1280, displayHeight: 6000 },
  ])(
    "disables retention when a small non-fluid iframe expands to $displayWidth × $displayHeight",
    async ({ displayWidth, displayHeight }) => {
      const { container, cleanup } = await renderEmbeddedDesignCanvas({
        displayWidth,
        displayHeight,
        fluid: false,
        effectiveScale: 0.02,
      });
      try {
        const iframe = container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        expect(iframe).not.toBeNull();
        expect(iframe!.parentElement!.parentElement!.style.transform).toBe(
          `scale(${displayWidth / 1280}, ${displayHeight / 900})`,
        );
        expect(iframe!.style.backfaceVisibility).toBe("visible");
        expect(iframe!.style.transform).toBe("");
      } finally {
        await cleanup();
      }
    },
  );

  it("ignores embedded zoom when retaining a small iframe", async () => {
    const { container, cleanup } = await renderEmbeddedDesignCanvas({
      fluid: false,
      zoom: 1000,
      effectiveScale: 0.5,
    });
    try {
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe).not.toBeNull();
      expect(iframe!.style.backfaceVisibility).toBe("hidden");
    } finally {
      await cleanup();
    }
  });

  it("uses the non-uniform embedded-frame height when limiting paint retention", async () => {
    const { container, cleanup } = await renderEmbeddedDesignCanvas({
      embeddedFrame: {
        viewportWidth: 1440,
        viewportHeight: 1440,
        displayWidth: 1440,
        displayHeight: 5000,
      },
      zoom: 100,
    });
    try {
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.style.backfaceVisibility).toBe("visible");
    } finally {
      await cleanup();
    }
  });

  it.each([
    { effectiveScale: 2, effectiveScaleY: 0.5 },
    { effectiveScale: 0.5, effectiveScaleY: 2 },
  ])(
    "uses the larger chrome scale ($effectiveScale, $effectiveScaleY) without embedded zoom",
    async ({ effectiveScale, effectiveScaleY }) => {
      const { container, cleanup } = await renderEmbeddedDesignCanvas({
        viewportWidth: 3000,
        fluid: false,
        zoom: 2,
        effectiveScale,
        effectiveScaleY,
      });
      try {
        const iframe = container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        );
        expect(iframe).not.toBeNull();
        expect(iframe!.style.backfaceVisibility).toBe("visible");
      } finally {
        await cleanup();
      }
    },
  );

  it("gives every scaled iframe the shared declaration or a named opt-out", () => {
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
        expect(element).toContain("opacity-0");
        expect(element).toContain("-100_000");
      }
    }
  });

  it("stays transform-free so a site with its own scale can spread it", () => {
    expect(SCALED_IFRAME_PAINT_RETENTION_STYLE).not.toHaveProperty("transform");
    expect(SCALED_IFRAME_PAINT_RETENTION_STYLE).not.toHaveProperty(
      "transformOrigin",
    );
    expect(SCALED_IFRAME_PAINT_RETENTION_STYLE.backfaceVisibility).toBe(
      "hidden",
    );
    for (const viewportHeight of [900, 42_000]) {
      const style = getIframePaintRetentionStyle({
        viewportWidth: 1280,
        viewportHeight,
        effectiveScale: 0.02,
      });
      expect(style).not.toHaveProperty("transform");
      expect(style).not.toHaveProperty("transformOrigin");
    }
  });

  it.each([0.02, 0.04, 0.25, 1])(
    "retains frames up to the raw axis limit at scale %s",
    (effectiveScale) => {
      expect(
        getIframePaintRetentionStyle({
          viewportWidth: MAX_RETAINED_IFRAME_PAINT_AXIS_PX,
          viewportHeight: MAX_RETAINED_IFRAME_PAINT_AXIS_PX,
          effectiveScale,
        }).backfaceVisibility,
      ).toBe("hidden");
      for (const viewport of [
        {
          viewportWidth: MAX_RETAINED_IFRAME_PAINT_AXIS_PX + 1,
          viewportHeight: 900,
        },
        {
          viewportWidth: 1280,
          viewportHeight: MAX_RETAINED_IFRAME_PAINT_AXIS_PX + 1,
        },
      ]) {
        expect(
          getIframePaintRetentionStyle({ ...viewport, effectiveScale })
            .backfaceVisibility,
        ).toBe("visible");
      }
    },
  );

  describe.each([0.02, 0.04])(
    "imported frames at scale %s",
    (effectiveScale) => {
      it.each([
        { viewportWidth: 1280, viewportHeight: 32_000 },
        { viewportWidth: 1280, viewportHeight: 42_000 },
        { viewportWidth: 32_000, viewportHeight: 900 },
        { viewportWidth: 42_000, viewportHeight: 900 },
      ])(
        "disables retention for a raw $viewportWidth × $viewportHeight viewport",
        (viewport) => {
          expect(
            getIframePaintRetentionStyle({ ...viewport, effectiveScale })
              .backfaceVisibility,
          ).toBe("visible");
        },
      );
    },
  );

  it("accounts for board replica magnification when deciding retention", () => {
    const sampledViewport = 4096;
    const boardScale = 32;

    expect(
      getIframePaintRetentionStyle({
        viewportWidth: sampledViewport,
        viewportHeight: sampledViewport,
        effectiveScale: boardScale * 0.0421,
      }).backfaceVisibility,
    ).toBe("visible");
    expect(
      getIframePaintRetentionStyle({
        viewportWidth: sampledViewport,
        viewportHeight: sampledViewport,
        effectiveScale: boardScale * 0.02,
      }).backfaceVisibility,
    ).toBe("hidden");
  });

  it("does not promote a large painted iframe into one GPU surface", () => {
    expect(
      getIframePaintRetentionStyle({
        viewportWidth: 1440,
        viewportHeight: MAX_RETAINED_IFRAME_PAINT_AXIS_PX + 1,
        effectiveScale: 1,
      }).backfaceVisibility,
    ).toBe("visible");
    expect(
      getIframePaintRetentionStyle({
        viewportWidth: 1440,
        viewportHeight: MAX_RETAINED_IFRAME_PAINT_AXIS_PX + 1,
        effectiveScale: 0.25,
      }).backfaceVisibility,
    ).toBe("visible");
    expect(
      getIframePaintRetentionStyle({
        viewportWidth: 1440,
        viewportHeight: 1440,
        effectiveScale: 1,
        effectiveScaleY: 3,
      }).backfaceVisibility,
    ).toBe("visible");
  });
});

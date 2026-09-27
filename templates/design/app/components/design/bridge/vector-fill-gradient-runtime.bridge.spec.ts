import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../../.generated/bridge/editor-chrome.generated";

function hydratedEditorChromeBridgeScript(): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace(
      "__DESIGN_CANVAS_SCREEN_ID__",
      JSON.stringify("vector-fill-gradient"),
    )
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "false")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", "false")
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

const VECTOR_HTML = `<!doctype html><html><body style="margin:0">
<svg data-agent-native-node-id="vector.1" data-an-primitive="pasted-svg" viewBox="0 0 200 100" style="width:200px;height:100px">
  <path d="M0 0 H200 V100 H0 Z" fill="#cccccc" stroke="#111111" stroke-width="4" />
</svg></body></html>`;
const GROUPED_VECTOR_HTML = VECTOR_HTML.replace(
  '<path d="M0 0 H200 V100 H0 Z" fill="#cccccc" stroke="#111111" stroke-width="4" />',
  '<g><path data-agent-native-node-id="vector.shape.1" d="M0 0 H90 V100 H0 Z" fill="#cccccc" stroke="#111111" stroke-width="4" /><path data-agent-native-node-id="vector.shape.2" d="M110 0 H200 V100 H110 Z" fill="#cccccc" stroke="#222222" stroke-width="4" /></g>',
);
const VECTOR_WITH_STROKE_GRADIENT_HTML = VECTOR_HTML.replace(
  '<path d="M0 0 H200 V100 H0 Z" fill="#cccccc" stroke="#111111" stroke-width="4" />',
  '<defs data-an-vector-stroke-gradient=""><linearGradient id="vector.1-stroke-gradient"><stop offset="0%" stop-color="#111111"/><stop offset="100%" stop-color="#eeeeee"/></linearGradient></defs><path d="M0 0 H200 V100 H0 Z" fill="#cccccc" style="stroke: url(#vector.1-stroke-gradient); stroke-width: 4" />',
);

async function sendFill(page: import("@playwright/test").Page, value: string) {
  await page.evaluate((nextValue) => {
    window.postMessage(
      {
        type: "style-change",
        selector: '[data-agent-native-node-id="vector.1"]',
        selectorCandidates: [],
        nodeId: "vector.1",
        property: "fill",
        value: nextValue,
      },
      "*",
    );
  }, value);
}

async function sendChildFill(
  page: import("@playwright/test").Page,
  nodeId: string,
  value: string,
) {
  await page.evaluate(
    ({ nodeId, value }) => {
      window.postMessage(
        {
          type: "style-change",
          selector: `[data-agent-native-node-id="${nodeId}"]`,
          selectorCandidates: [],
          nodeId,
          property: "fill",
          value,
        },
        "*",
      );
    },
    { nodeId, value },
  );
}

async function sendStroke(
  page: import("@playwright/test").Page,
  value: string,
) {
  await page.evaluate((nextValue) => {
    window.postMessage(
      {
        type: "style-change",
        selector: '[data-agent-native-node-id="vector.1"]',
        selectorCandidates: [],
        nodeId: "vector.1",
        property: "stroke",
        value: nextValue,
      },
      "*",
    );
  }, value);
}

async function sendChildStroke(
  page: import("@playwright/test").Page,
  nodeId: string,
  value: string,
) {
  await page.evaluate(
    ({ nodeId, value }) => {
      window.postMessage(
        {
          type: "style-change",
          selector: `[data-agent-native-node-id="${nodeId}"]`,
          selectorCandidates: [],
          nodeId,
          property: "stroke",
          value,
        },
        "*",
      );
    },
    { nodeId, value },
  );
}

async function pixels(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const svg = document.querySelector<SVGSVGElement>(
      '[data-agent-native-node-id="vector.1"]',
    )!;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 100;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return {
        left: Array.from(context.getImageData(10, 50, 1, 1).data),
        right: Array.from(context.getImageData(190, 50, 1, 1).data),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

describe("live SVG vector fill gradients", () => {
  it("fans a root fill gradient out to every shape in a pasted SVG", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(GROUPED_VECTOR_HTML);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await sendFill(
        page,
        "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
      );
      const gradient = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        const shapes = Array.from(root.querySelectorAll("path"));
        return {
          fills: shapes.map((shape) => shape.style.fill),
          authoredFills: shapes.map((shape) => shape.getAttribute("fill")),
          metadata: root.style.getPropertyValue("--an-vector-fill-gradient"),
          shapeMetadata: shapes.map((shape) =>
            shape.style.getPropertyValue("--an-vector-fill-gradient"),
          ),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-fill-gradient] linearGradient",
          ).length,
        };
      });
      expect(gradient.fills).toHaveLength(2);
      expect(gradient.fills[0]).toBe(gradient.fills[1]);
      expect(gradient.fills[0]).toMatch(
        /^url\(["']?#vector\.1-fill-gradient["']?\)$/,
      );
      expect(gradient.authoredFills).toEqual(["#cccccc", "#cccccc"]);
      expect(gradient.metadata).toContain("linear-gradient");
      expect(gradient.shapeMetadata).toEqual(["", ""]);
      expect(gradient.definitions).toBe(1);

      await sendFill(page, "#00ff00");
      const solid = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        return {
          fills: Array.from(root.querySelectorAll("path")).map(
            (shape) => shape.style.fill,
          ),
          metadata: root.style.getPropertyValue("--an-vector-fill-gradient"),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-fill-gradient] linearGradient",
          ).length,
        };
      });
      expect(solid).toEqual({
        fills: ["rgb(0, 255, 0)", "rgb(0, 255, 0)"],
        metadata: "",
        definitions: 0,
      });
    } finally {
      await browser.close();
    }
  });

  it("keeps a shared root gradient for shapes not repainted individually", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(GROUPED_VECTOR_HTML);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await sendFill(
        page,
        "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
      );
      await sendChildFill(page, "vector.shape.1", "#00ff00");

      const paint = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        return {
          fills: Array.from(root.querySelectorAll("path")).map(
            (shape) => shape.style.fill,
          ),
          metadata: Array.from(root.querySelectorAll("path")).map((shape) =>
            shape.style.getPropertyValue("--an-vector-fill-gradient"),
          ),
          rootMetadata: root.style.getPropertyValue(
            "--an-vector-fill-gradient",
          ),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-fill-gradient] linearGradient",
          ).length,
        };
      });
      expect(paint.fills[0]).toBe("rgb(0, 255, 0)");
      expect(paint.fills[1]).toMatch(
        /^url\(["']?#vector\.1-fill-gradient["']?\)$/,
      );
      expect(paint.metadata[0]).toBe("");
      expect(paint.metadata[1]).toContain("linear-gradient");
      expect(paint.rootMetadata).toBe("");
      expect(paint.definitions).toBe(1);
    } finally {
      await browser.close();
    }
  });

  it("fans a root stroke gradient out to every shape in a pasted SVG", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(GROUPED_VECTOR_HTML);
      await page.addScriptTag({ content: hydratedEditorChromeBridgeScript() });

      await sendStroke(
        page,
        "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
      );
      const gradient = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        const shapes = Array.from(root.querySelectorAll("path"));
        return {
          strokes: shapes.map((shape) => shape.style.stroke),
          metadata: root.style.getPropertyValue("--an-vector-stroke-gradient"),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-stroke-gradient] linearGradient",
          ).length,
        };
      });
      expect(gradient.strokes).toHaveLength(2);
      expect(gradient.strokes[0]).toBe(gradient.strokes[1]);
      expect(gradient.strokes[0]).toMatch(
        /^url\(["']?#vector\.1-stroke-gradient["']?\)$/,
      );
      expect(gradient.metadata).toContain("linear-gradient");
      expect(gradient.definitions).toBe(1);

      await sendStroke(page, "#00ff00");
      const solid = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        return {
          strokes: Array.from(root.querySelectorAll("path")).map(
            (shape) => shape.style.stroke,
          ),
          metadata: root.style.getPropertyValue("--an-vector-stroke-gradient"),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-stroke-gradient] linearGradient",
          ).length,
        };
      });
      expect(solid).toEqual({
        strokes: ["rgb(0, 255, 0)", "rgb(0, 255, 0)"],
        metadata: "",
        definitions: 0,
      });
    } finally {
      await browser.close();
    }
  });

  it("clears a grouped child's stroke gradient when changed back to solid", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(GROUPED_VECTOR_HTML);
      await page.addScriptTag({
        content: hydratedEditorChromeBridgeScript(),
      });

      await sendChildStroke(
        page,
        "vector.shape.2",
        "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
      );
      const gradient = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        const target = document.querySelector<SVGPathElement>(
          '[data-agent-native-node-id="vector.shape.2"]',
        )!;
        const sibling = document.querySelector<SVGPathElement>(
          '[data-agent-native-node-id="vector.shape.1"]',
        )!;
        return {
          stroke: target.style.stroke,
          gradient: target.style.getPropertyValue(
            "--an-vector-stroke-gradient",
          ),
          siblingStroke: sibling.getAttribute("stroke"),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-stroke-gradient] linearGradient",
          ).length,
        };
      });
      expect(gradient.stroke).toMatch(
        /^url\(["']?#vector\.1-stroke-gradient["']?\)$/,
      );
      expect(gradient.gradient).toContain("linear-gradient");
      expect(gradient.siblingStroke).toBe("#111111");
      expect(gradient.definitions).toBe(1);

      await sendChildStroke(page, "vector.shape.2", "#00ff00");
      const solid = await page.evaluate(() => {
        const root = document.querySelector<SVGSVGElement>(
          '[data-agent-native-node-id="vector.1"]',
        )!;
        const target = document.querySelector<SVGPathElement>(
          '[data-agent-native-node-id="vector.shape.2"]',
        )!;
        const sibling = document.querySelector<SVGPathElement>(
          '[data-agent-native-node-id="vector.shape.1"]',
        )!;
        return {
          stroke: target.style.stroke,
          gradient: target.style.getPropertyValue(
            "--an-vector-stroke-gradient",
          ),
          siblingStroke: sibling.getAttribute("stroke"),
          definitions: root.querySelectorAll(
            ":scope > defs[data-an-vector-stroke-gradient] linearGradient",
          ).length,
        };
      });
      expect(solid).toEqual({
        stroke: "rgb(0, 255, 0)",
        gradient: "",
        siblingStroke: "#111111",
        definitions: 0,
      });
    } finally {
      await browser.close();
    }
  });

  it(
    "previews off-center radial headers with their authored position and extent",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(VECTOR_HTML);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await sendFill(
          page,
          "radial-gradient(circle at right top, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        const geometry = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const gradient = svg.querySelector<SVGRadialGradientElement>(
            "defs[data-an-vector-fill-gradient] radialGradient",
          )!;
          return {
            cx: gradient.getAttribute("cx"),
            cy: gradient.getAttribute("cy"),
            radius: gradient.getAttribute("r"),
          };
        });
        expect(geometry.cx).toBe("200");
        expect(geometry.cy).toBe("0");
        expect(Number(geometry.radius)).toBeCloseTo(Math.hypot(200, 100));

        const rendered = await pixels(page);
        expect(rendered.right[0]).toBeGreaterThan(rendered.right[2]);
        expect(rendered.left[2]).toBeGreaterThan(rendered.left[0]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "uses viewBox units and per-axis ellipse radii for side sizing",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(VECTOR_HTML);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        await page
          .locator('[data-agent-native-node-id="vector.1"]')
          .evaluate((svg) => {
            svg.setAttribute("viewBox", "10 20 200 100");
            svg.style.width = "400px";
            svg.style.height = "200px";
          });

        await sendFill(
          page,
          "radial-gradient(ellipse closest-side at 25% 30%, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        const closest = await page.evaluate(() => {
          const gradient = document.querySelector<SVGRadialGradientElement>(
            "defs[data-an-vector-fill-gradient] radialGradient",
          )!;
          return {
            cx: gradient.getAttribute("cx"),
            cy: gradient.getAttribute("cy"),
            transform: gradient.getAttribute("gradientTransform"),
          };
        });
        expect(closest.cx).toBe("60");
        expect(closest.cy).toBe("50");
        expect(closest.transform).toBe(
          "translate(60 50) scale(50 30) translate(-60 -50)",
        );

        await sendFill(
          page,
          "radial-gradient(ellipse farthest-side at 25% 30%, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        const farthest = await page.evaluate(() =>
          document
            .querySelector<SVGRadialGradientElement>(
              "defs[data-an-vector-fill-gradient] radialGradient",
            )!
            .getAttribute("gradientTransform"),
        );
        expect(farthest).toBe(
          "translate(60 50) scale(150 70) translate(-60 -50)",
        );
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "renders the intermediate fill, preserves stroke, and clears only its paint server",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setContent(VECTOR_HTML);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await sendFill(
          page,
          "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        const live = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const path = svg.querySelector("path")!;
          const gradient = svg.querySelector(
            "defs[data-an-vector-fill-gradient] linearGradient",
          );
          return {
            reference: (path as SVGElement & { style: CSSStyleDeclaration })
              .style.fill,
            stops: gradient?.querySelectorAll("stop").length ?? 0,
            metadata: svg.style.getPropertyValue("--an-vector-fill-gradient"),
            stroke: path.getAttribute("stroke"),
            strokeWidth: path.getAttribute("stroke-width"),
          };
        });
        expect(live.reference).toMatch(/^url\(["']?#.+["']?\)$/);
        expect(live.stops).toBe(2);
        expect(live.metadata).toContain("linear-gradient");
        expect(live.stroke).toBe("#111111");
        expect(live.strokeWidth).toBe("4");
        const samples = await pixels(page);
        expect(samples.left[0]).toBeGreaterThan(samples.left[2]);
        expect(samples.right[2]).toBeGreaterThan(samples.right[0]);

        await sendFill(page, "#00ff00");
        await page.waitForFunction(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          );
          return (
            !svg?.querySelector("defs[data-an-vector-fill-gradient]") &&
            svg
              ?.querySelector("path")
              ?.getAttribute("style")
              ?.includes("fill: rgb(0, 255, 0)")
          );
        });
        const solid = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const path = svg.querySelector("path")!;
          return {
            metadata: svg.style.getPropertyValue("--an-vector-fill-gradient"),
            stroke: path.getAttribute("stroke"),
          };
        });
        expect(solid).toEqual({ metadata: "", stroke: "#111111" });
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "renders persisted fill paint-server markup after bridge injection",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(
          VECTOR_HTML.replace(
            '<path d="M0 0 H200 V100 H0 Z" fill="#cccccc" stroke="#111111" stroke-width="4" />',
            '<defs data-an-vector-fill-gradient=""><linearGradient id="vector.1-fill-gradient" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="200" y2="50"><stop offset="0%" stop-color="rgb(255 0 0)" /><stop offset="100%" stop-color="rgb(0 0 255)" /></linearGradient></defs><path d="M0 0 H200 V100 H0 Z" style="fill: url(#vector.1-fill-gradient)" stroke="#111111" stroke-width="4" />',
          ),
        );
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });
        const rendered = await pixels(page);
        expect(rendered.left[0]).toBeGreaterThan(rendered.left[2]);
        expect(rendered.right[2]).toBeGreaterThan(rendered.right[0]);
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "renders linear and radial stroke gradients and keeps fill paint servers independent",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(VECTOR_HTML);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await sendStroke(
          page,
          "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        await sendFill(
          page,
          "linear-gradient(0deg, rgb(0, 255, 0) 0%, rgb(255, 255, 0) 100%)",
        );
        const linear = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const path = svg.querySelector("path")!;
          const strokeGradient = svg.querySelector(
            "defs[data-an-vector-stroke-gradient] linearGradient",
          );
          return {
            stroke: (path as SVGElement & { style: CSSStyleDeclaration }).style
              .stroke,
            strokeStops: strokeGradient?.querySelectorAll("stop").length ?? 0,
            strokeMetadata: svg.style.getPropertyValue(
              "--an-vector-stroke-gradient",
            ),
            fill: (path as SVGElement & { style: CSSStyleDeclaration }).style
              .fill,
            fillGradient: svg.querySelector(
              "defs[data-an-vector-fill-gradient] linearGradient",
            ),
          };
        });
        expect(linear.stroke).toMatch(
          /^url\(["']?#vector\.1-stroke-gradient["']?\)$/,
        );
        expect(linear.strokeStops).toBe(2);
        expect(linear.strokeMetadata).toContain("linear-gradient");
        expect(linear.fill).toMatch(/^url\(/);
        expect(linear.fillGradient).not.toBeNull();

        const linearStrokePixels = await page.evaluate(async () => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const blob = new Blob(
            [new XMLSerializer().serializeToString(svg.cloneNode(true))],
            { type: "image/svg+xml" },
          );
          const url = URL.createObjectURL(blob);
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 200;
            canvas.height = 100;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return {
              left: Array.from(context.getImageData(1, 50, 1, 1).data),
              right: Array.from(context.getImageData(199, 50, 1, 1).data),
            };
          } finally {
            URL.revokeObjectURL(url);
          }
        });
        expect(linearStrokePixels.left[0]).toBeGreaterThan(
          linearStrokePixels.left[2],
        );
        expect(linearStrokePixels.right[2]).toBeGreaterThan(
          linearStrokePixels.right[0],
        );

        await sendStroke(
          page,
          "radial-gradient(circle at center, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        const radial = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const path = svg.querySelector("path")!;
          const gradient = svg.querySelector(
            "defs[data-an-vector-stroke-gradient] radialGradient",
          );
          return {
            stroke: (path as SVGElement & { style: CSSStyleDeclaration }).style
              .stroke,
            strokeDefs: svg.querySelectorAll(
              ":scope > defs[data-an-vector-stroke-gradient]",
            ).length,
            gradientId: gradient?.getAttribute("id"),
            fillGradientCount: svg.querySelectorAll(
              "defs[data-an-vector-fill-gradient] linearGradient",
            ).length,
          };
        });
        expect(radial.stroke).toMatch(
          /^url\(["']?#vector\.1-stroke-gradient["']?\)$/,
        );
        expect(radial.strokeDefs).toBe(1);
        expect(radial.gradientId).toBe("vector.1-stroke-gradient");
        expect(radial.fillGradientCount).toBe(1);

        await sendStroke(page, "#00ff00");
        const cleared = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const path = svg.querySelector("path")!;
          return {
            strokeDefs: svg.querySelectorAll(
              ":scope > defs[data-an-vector-stroke-gradient]",
            ).length,
            fillDefs: svg.querySelectorAll(
              ":scope > defs[data-an-vector-fill-gradient]",
            ).length,
            strokeMetadata: svg.style.getPropertyValue(
              "--an-vector-stroke-gradient",
            ),
            fill: (path as SVGElement & { style: CSSStyleDeclaration }).style
              .fill,
          };
        });
        expect(cleared).toEqual({
          strokeDefs: 0,
          fillDefs: 1,
          strokeMetadata: "",
          fill: linear.fill,
        });
      } finally {
        await browser.close();
      }
    },
  );

  it(
    "keeps an existing SVG stroke gradient when adding a fill gradient",
    { timeout: 30_000 },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent(VECTOR_WITH_STROKE_GRADIENT_HTML);
        await page.addScriptTag({
          content: hydratedEditorChromeBridgeScript(),
        });

        await sendFill(
          page,
          "linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)",
        );
        const state = await page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>(
            '[data-agent-native-node-id="vector.1"]',
          )!;
          const path = svg.querySelector("path")!;
          return {
            fillDefs: svg.querySelectorAll(
              ":scope > defs[data-an-vector-fill-gradient]",
            ).length,
            strokeDefs: svg.querySelectorAll(
              ":scope > defs[data-an-vector-stroke-gradient]",
            ).length,
            fill: (path as SVGElement & { style: CSSStyleDeclaration }).style
              .fill,
            stroke: (path as SVGElement & { style: CSSStyleDeclaration }).style
              .stroke,
          };
        });
        expect(state.fillDefs).toBe(1);
        expect(state.strokeDefs).toBe(1);
        expect(state.fill).toMatch(/fill|url\(#vector\.1-fill-gradient\)/i);
        expect(state.stroke).toMatch(
          /^url\(["']?#vector\.1-stroke-gradient["']?\)$/,
        );
        const rendered = await pixels(page);
        expect(rendered.left[0]).toBeGreaterThan(rendered.left[2]);
        expect(rendered.right[2]).toBeGreaterThan(rendered.right[0]);
      } finally {
        await browser.close();
      }
    },
  );
});

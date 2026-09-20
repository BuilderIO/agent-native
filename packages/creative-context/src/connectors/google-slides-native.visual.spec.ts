import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import { compareRasterImages } from "../../../core/src/ingestion/media.js";
import { compileGoogleSlidesPresentation } from "./google-slides-native.js";

describe("Google Slides native compiler visual fidelity", () => {
  it("keeps source-render geometry and color within the pixel-diff gate", async () => {
    const [compiled] = await compileGoogleSlidesPresentation(
      {
        pageSize: {
          width: { magnitude: 960, unit: "PX" },
          height: { magnitude: 540, unit: "PX" },
        },
        slides: [
          {
            objectId: "slide-visual",
            pageElements: [
              {
                objectId: "rect-1",
                size: {
                  width: { magnitude: 200, unit: "PX" },
                  height: { magnitude: 100, unit: "PX" },
                },
                transform: {
                  scaleX: 0.8660254,
                  scaleY: 0.8660254,
                  shearX: -0.5,
                  shearY: 0.5,
                  translateX: 200,
                  translateY: 90,
                  unit: "PX",
                },
                shape: {
                  shapeType: "RECT",
                  shapeProperties: {
                    shapeBackgroundFill: {
                      solidFill: {
                        color: {
                          rgbColor: { red: 1, green: 0, blue: 0 },
                        },
                      },
                    },
                  },
                },
              },
              {
                objectId: "ellipse-shear",
                size: {
                  width: { magnitude: 160, unit: "PX" },
                  height: { magnitude: 120, unit: "PX" },
                },
                transform: {
                  scaleX: 1,
                  scaleY: 1,
                  shearX: 0.25,
                  shearY: -0.1,
                  translateX: 520,
                  translateY: 280,
                  unit: "PX",
                },
                shape: {
                  shapeType: "ELLIPSE",
                  shapeProperties: {
                    shapeBackgroundFill: {
                      solidFill: {
                        color: {
                          rgbColor: { red: 0.2, green: 0.4, blue: 1 },
                        },
                        alpha: 0.7,
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      {
        presentationId: "visual-fixture",
        resolveAsset: async () => {
          throw new Error("visual fixture has no assets");
        },
      },
    );
    const sourceRender = `<div style="position:relative;width:960px;height:540px;overflow:hidden;background:#fff">
      <div style="position:absolute;left:0;top:0;width:200px;height:100px;transform:matrix(0.8660254,0.5,-0.5,0.8660254,200,90);transform-origin:0 0;background:#ff0000"></div>
      <div style="position:absolute;left:0;top:0;width:160px;height:120px;transform:matrix(1,-0.1,0.25,1,520,280);transform-origin:0 0;background:rgba(51,102,255,0.7);border-radius:50%"></div>
    </div>`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 960, height: 540 },
        deviceScaleFactor: 1,
      });
      const render = async (html: string) => {
        await page.setContent(
          `<style>html,body{margin:0;width:960px;height:540px;overflow:hidden}</style>${html}`,
        );
        return page.screenshot({ type: "png" });
      };
      const source = await render(sourceRender);
      const actual = await render(compiled!.html);
      const { meanAbsoluteDifference } = await compareRasterImages({
        source,
        rendered: actual,
      });
      expect(meanAbsoluteDifference).toBeLessThan(0.75);
      expect(compiled!.nativeArtifact.fidelityReport).toEqual({
        exact: { count: 2 },
        approximated: { count: 0, reasons: [] },
        imageFallback: { count: 0, reasons: [] },
      });
    } finally {
      await browser.close();
    }
  }, 15_000);
});

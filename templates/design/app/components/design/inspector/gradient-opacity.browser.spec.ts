import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { gradientToCss, type GradientValue } from "./GradientEditor";

it("gradient fill opacity matches whole-gradient compositing without shifting colors", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 200, height: 100 },
    });
    for (const endColor of ["#0000ff", "rgba(0,0,255,0)"]) {
      for (const opacity of [20, 0, 100]) {
        const gradient: GradientValue = {
          kind: "linear",
          angle: 90,
          stops: [
            { id: "a", color: "#ff0000", position: 0 },
            { id: "b", color: endColor, position: 100 },
          ],
        };
        await page.setContent(
          `<style>body{margin:0}div{position:absolute;width:100px;height:100px}</style><div style="background:${gradientToCss(gradient)};opacity:${opacity / 100}"></div><div style="left:100px;background:${gradientToCss({ ...gradient, opacity })}"></div>`,
        );
        const png = await page.screenshot({ omitBackground: true });
        const maxDifference = await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          let difference = 0;
          for (let x = 0; x < 100; x++) {
            const a = ctx.getImageData(x, 50, 1, 1).data;
            const b = ctx.getImageData(x + 100, 50, 1, 1).data;
            difference = Math.max(difference, Math.abs(a[3] - b[3]));
            for (let channel = 0; channel < 3; channel++) {
              difference = Math.max(
                difference,
                Math.abs(
                  Math.round((a[channel] * a[3]) / 255) -
                    Math.round((b[channel] * b[3]) / 255),
                ),
              );
            }
          }
          return difference;
        }, png.toString("base64"));
        expect(maxDifference).toBeLessThanOrEqual(1);
      }
    }
  } finally {
    await browser.close();
  }
}, 30_000);

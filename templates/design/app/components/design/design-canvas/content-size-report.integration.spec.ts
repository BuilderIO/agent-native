import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveAutoFitScreenHeight } from "../multi-screen/screen-height";
import { appendContentSizeReporter } from "./content-size-report";
import { buildInteractPreviewDocument } from "./interact-document";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ chromiumSandbox: true });
});
afterAll(async () => {
  await browser?.close();
});

const SOURCE =
  '<!doctype html><html><body style="margin:0"><main style="height:1000px">Content</main><footer style="height:80px">Footer</footer></body></html>';

describe("resolved frame height in Chromium", () => {
  it.each(["editor", "interact"] as const)(
    "reports natural height for unmarked hug HTML in %s while fixed geometry remains unchanged",
    async (surface) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        for (const mode of ["hug", "fixed"] as const) {
          const html =
            surface === "editor"
              ? appendContentSizeReporter(SOURCE, mode)
              : buildInteractPreviewDocument({
                  content: SOURCE,
                  fitBodyToFrame: mode !== "hug",
                  heightMode: mode,
                });
          await page.setContent(
            '<div style="width:600px;height:800px;overflow:clip"><iframe style="width:600px;height:800px;border:0"></iframe></div>',
          );
          await page.evaluate((content) => {
            const reports: Array<{ naturalHeight: number | null }> = [];
            (window as unknown as { reports: typeof reports }).reports =
              reports;
            window.addEventListener("message", (event) => {
              if (
                event.source ===
                  document.querySelector("iframe")?.contentWindow &&
                event.data?.type === "agent-native:content-size"
              )
                reports.push(event.data);
            });
            document.querySelector("iframe")!.srcdoc = content;
          }, html);
          if (surface === "interact" && mode === "fixed") {
            expect(html).not.toContain("data-agent-native-content-size-bridge");
            continue;
          }
          await page.waitForFunction(
            () =>
              (window as unknown as { reports: unknown[] }).reports.length > 0,
            undefined,
            { timeout: 2000 },
          );
          const report = await page.evaluate(() => {
            const reports = (
              window as unknown as {
                reports: Array<{ naturalHeight: number | null }>;
              }
            ).reports;
            return reports[reports.length - 1];
          });
          expect(report.naturalHeight).toBe(mode === "hug" ? 1080 : null);
          const frameHeight = resolveAutoFitScreenHeight({
            mode,
            width: 600,
            currentHeight: 800,
            measuredHeight: report.naturalHeight ?? 1080,
          });
          expect(frameHeight).toBe(mode === "hug" ? 1080 : 800);
          expect(
            await page
              .frameLocator("iframe")
              .locator("meta[data-agent-native-screen-height-mode]")
              .count(),
          ).toBe(0);
        }
      } finally {
        await context.close();
      }
    },
  );
});

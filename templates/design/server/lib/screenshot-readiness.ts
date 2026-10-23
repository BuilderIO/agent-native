import { fail } from "@agent-native/core/action";
import type { Page } from "@playwright/test";

export async function prepareScreenshotPage(
  page: Page,
  html: string,
): Promise<void> {
  await page.setContent(html, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const pendingImages = () =>
    page.evaluate(() =>
      Array.from(document.images)
        .filter((image) => !image.complete)
        .map(
          (image) =>
            image.currentSrc ||
            image.getAttribute("src") ||
            "(image without src)",
        ),
    );
  if ((await pendingImages()).length > 0) {
    try {
      await page.waitForFunction(
        () => Array.from(document.images).every((image) => image.complete),
        undefined,
        { timeout: 5_000, polling: 100 },
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "TimeoutError")
        throw error;
      const pending = await pendingImages();
      if (pending.length)
        fail("Screenshot images did not finish loading within 5 seconds.", {
          errorCode: "screenshot_images_unready",
          statusCode: 422,
          details: { pendingImages: pending, cause: error.message },
        });
    }
  }
  const fontsReady = await page.evaluate(async () => {
    if (!document.fonts) return true;
    return Promise.race([
      document.fonts.ready.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 4_000),
      ),
    ]);
  });
  if (!fontsReady) {
    fail("Screenshot fonts did not finish loading within 4 seconds.", {
      errorCode: "screenshot_fonts_unready",
      statusCode: 422,
    });
  }
  try {
    await page.waitForFunction(
      () => {
        const win = window as unknown as {
          __anExportRuleCounts?: number[];
          __anExportRuleStart?: number;
        };
        win.__anExportRuleStart ??= Date.now();
        const count = Array.from(document.styleSheets).reduce((sum, sheet) => {
          try {
            return sum + (sheet.cssRules?.length ?? 0);
          } catch {
            return sum + 1;
          }
        }, 0);
        const history = [...(win.__anExportRuleCounts ?? []).slice(-5), count];
        win.__anExportRuleCounts = history;
        return (
          history.length >= 6 &&
          history.every((value) => value === history[0]) &&
          Date.now() - win.__anExportRuleStart >= 600
        );
      },
      undefined,
      { timeout: 2_500, polling: 100 },
    );
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
    fail("Screenshot styles did not settle within 2.5 seconds.", {
      errorCode: "screenshot_styles_unready",
      statusCode: 422,
      details: { cause: error.message },
    });
  }
}

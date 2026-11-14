import { fail } from "@agent-native/core/action";
import type { Page, Request, Response } from "@playwright/test";

export async function prepareScreenshotPage(
  page: Page,
  html: string,
): Promise<void> {
  const pendingStylesheetRequests = new Set<Request>();
  const failedStylesheets = new Map<string, string>();
  let wakeStylesheets: (() => void) | undefined;
  const requestStarted = (request: Request) => {
    if (request.resourceType() !== "stylesheet") return;
    pendingStylesheetRequests.add(request);
    wakeStylesheets?.();
  };
  const requestFinished = (request: Request) => {
    if (request.resourceType() !== "stylesheet") return;
    pendingStylesheetRequests.delete(request);
    wakeStylesheets?.();
  };
  const requestFailed = (request: Request) => {
    if (request.resourceType() !== "stylesheet") return;
    failedStylesheets.set(
      request.url(),
      request.failure()?.errorText ?? "Stylesheet request failed",
    );
    requestFinished(request);
  };
  const responseReceived = (response: Response) => {
    if (
      response.request().resourceType() === "stylesheet" &&
      response.status() >= 400
    ) {
      failedStylesheets.set(response.url(), `HTTP ${response.status()}`);
      wakeStylesheets?.();
    }
  };
  page.on("request", requestStarted);
  page.on("requestfinished", requestFinished);
  page.on("requestfailed", requestFailed);
  page.on("response", responseReceived);
  try {
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const pendingImages = () =>
      page.evaluate(() => {
        for (const image of document.images)
          if (image.loading === "lazy") image.loading = "eager";
        return Array.from(document.images)
          .filter((image) => !image.complete)
          .map(
            (image) =>
              image.currentSrc ||
              image.getAttribute("src") ||
              "(image without src)",
          );
      });
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
    const stylesheetDeadline = Date.now() + 5_000;
    while (true) {
      const pendingSheets = await page.evaluate(() => {
        const pending = new Set<string>();
        const visited = new Set<CSSStyleSheet>();
        const visit = (sheet: CSSStyleSheet): void => {
          if (sheet.disabled || visited.has(sheet)) return;
          visited.add(sheet);
          let rules: CSSRule[];
          try {
            rules = Array.from(sheet.cssRules);
          } catch (error) {
            // Cross-origin sheet contents rely on the tracked stylesheet requests.
            if (error instanceof DOMException && error.name === "SecurityError")
              return;
            throw error;
          }
          for (const rule of rules) {
            if (rule.type !== CSSRule.IMPORT_RULE) continue;
            const imported = rule as CSSImportRule;
            if (imported.styleSheet) visit(imported.styleSheet);
            else pending.add(imported.href);
          }
        };
        for (const link of document.querySelectorAll<HTMLLinkElement>(
          'link[rel~="stylesheet" i][href]',
        )) {
          if (
            !link.disabled &&
            link.getAttribute("href")?.trim() &&
            !link.sheet
          )
            pending.add(link.href);
        }
        for (const sheet of document.styleSheets) visit(sheet);
        return [...pending];
      });
      if (failedStylesheets.size)
        fail("Screenshot stylesheets could not be loaded.", {
          errorCode: "screenshot_styles_failed",
          statusCode: 422,
          details: {
            failedStylesheets: [...failedStylesheets]
              .slice(0, 20)
              .map(([url, cause]) => ({ url, cause })),
          },
        });
      const pending = [
        ...new Set([
          ...pendingSheets,
          ...[...pendingStylesheetRequests].map((request) => request.url()),
        ]),
      ];
      if (!pending.length) break;
      const remaining = stylesheetDeadline - Date.now();
      if (remaining <= 0)
        fail(
          "Screenshot stylesheets did not finish loading within 5 seconds.",
          {
            errorCode: "screenshot_styles_unready",
            statusCode: 422,
            details: { pendingStylesheets: pending.slice(0, 20) },
          },
        );
      await new Promise<void>((resolve) => {
        const settle = () => {
          clearTimeout(timer);
          wakeStylesheets = undefined;
          resolve();
        };
        const timer = setTimeout(settle, Math.min(100, remaining));
        wakeStylesheets = settle;
      });
    }
    const fontsReady = await page.evaluate(async () => {
      document.documentElement.getBoundingClientRect();
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
  } finally {
    wakeStylesheets?.();
    page.off("request", requestStarted);
    page.off("requestfinished", requestFinished);
    page.off("requestfailed", requestFailed);
    page.off("response", responseReceived);
  }
}

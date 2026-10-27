import type { Page, Response as PlaywrightResponse } from "@playwright/test";

import { visibleText } from "./journey-browser";
import {
  crossedLanes,
  laneOf,
  looksLikeNotFound,
  signInNavigationReason,
} from "./journey-checks";

export interface AppOutcome {
  summary: string;
  /** Every problem, each prefixed with the app, empty when it opened. */
  problems: string[];
}

/** True if `wait` resolves, false if it times out; the caller reports false. */
async function arrived(wait: Promise<unknown>): Promise<boolean> {
  return wait.then(
    () => true,
    // coercion-ok: a timeout is reported as a problem by every caller.
    () => false,
  );
}

/**
 * Open one workspace app through its Dispatch route and say what happened:
 * the Dispatch page's status and origin before and after, whether the app's
 * host and embedded frame rendered, which lane the frame started and ended
 * on, and whether the frame is a not-found or sign-in screen.
 */
export async function openWorkspaceApp(
  page: Page,
  origin: string,
  app: { id: string; name: string },
): Promise<AppOutcome> {
  const route = `/apps/${encodeURIComponent(app.id)}`;
  const problems: string[] = [];
  const frameDocuments = new Map<string, number>();
  const onResponse = (response: PlaywrightResponse) => {
    if (
      response.request().resourceType() === "document" &&
      response.frame() !== page.mainFrame()
    ) {
      frameDocuments.set(response.url(), response.status());
    }
  };
  page.on("response", onResponse);
  let topStatus: number | null = null;
  let iframeSrc = "(none)";
  let iframeFinal = "(none)";
  const finish = (): AppOutcome => {
    const after = URL.canParse(page.url())
      ? new URL(page.url()).origin
      : page.url();
    if (after !== origin) {
      problems.push(
        `the top-level page left the Dispatch origin: ${origin} -> ${after}`,
      );
    }
    return {
      summary: `${app.id} (${app.name}): route=${route} status=${String(topStatus)} top ${origin} -> ${after}; iframe ${iframeSrc} -> ${iframeFinal}${problems.length > 0 ? " FAILED" : " ok"}`,
      problems: problems.map(
        (problem) => `${app.id} (${app.name}): ${problem}`,
      ),
    };
  };
  try {
    const response = await page.goto(`${origin}${route}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    topStatus = response?.status() ?? null;
    if (topStatus !== 200) {
      problems.push(`Dispatch route answered HTTP ${String(topStatus)}`);
    }

    const host = page.locator("[data-dispatch-workspace-app-host]");
    if (!(await arrived(host.waitFor({ state: "visible", timeout: 30_000 })))) {
      const notFound = await page
        .getByRole("heading", { name: "App not found" })
        .count();
      problems.push(
        notFound > 0
          ? 'Dispatch rendered "App not found" for an app its own list returned'
          : `no workspace app host rendered; page text: ${JSON.stringify((await visibleText(page)).slice(0, 300))}`,
      );
      return finish();
    }

    const frameElement = page
      .locator("[data-dispatch-workspace-app-frame]")
      .first();
    if (
      !(await arrived(
        frameElement.waitFor({ state: "attached", timeout: 45_000 }),
      ))
    ) {
      problems.push(
        `the embedded app never rendered (no embed session or an error pane); host text: ${JSON.stringify((await host.innerText()).slice(0, 300))}`,
      );
      return finish();
    }

    iframeSrc = (await frameElement.getAttribute("src")) ?? "(no src)";
    const handle = await frameElement.elementHandle();
    const frame = await handle?.contentFrame();
    if (!frame) {
      problems.push("the embed iframe has no content frame");
      return finish();
    }
    const loaded = await arrived(
      frame.waitForLoadState("domcontentloaded", { timeout: 45_000 }),
    );
    iframeFinal = frame.url();
    if (!loaded) {
      problems.push(
        `the embedded app did not finish loading (at ${iframeFinal})`,
      );
    }
    if (/^(?:chrome-error|about):/.test(iframeFinal)) {
      problems.push(
        `the embedded app never displayed: the frame is at ${iframeFinal} (blocked, unreachable, or never navigated), src was ${iframeSrc}`,
      );
    }

    if (URL.canParse(iframeSrc) && URL.canParse(iframeFinal)) {
      const from = new URL(iframeSrc);
      const to = new URL(iframeFinal);
      if (crossedLanes(from.hostname, to.hostname)) {
        problems.push(
          `the embedded app was redirected across lanes: ${from.origin} (${laneOf(from.hostname)}) -> ${to.origin} (${laneOf(to.hostname)})`,
        );
      }
      const signIn = signInNavigationReason(iframeFinal, [to.origin]);
      if (signIn) {
        problems.push(`the embedded app ended on ${signIn} (${iframeFinal})`);
      }
    }
    const finalStatus = frameDocuments.get(iframeFinal);
    if (finalStatus !== undefined && finalStatus >= 400) {
      problems.push(
        `the embedded app's document answered HTTP ${finalStatus} (${iframeFinal})`,
      );
    }
    try {
      const frameText = await frame.evaluate(
        () => document.body?.innerText ?? "",
      );
      if (looksLikeNotFound(frameText)) {
        problems.push(
          `the embedded app shows a not-found screen: ${JSON.stringify(frameText.trim().slice(0, 160))}`,
        );
      }
    } catch (error) {
      problems.push(
        `the embedded app's page could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return finish();
  } catch (error) {
    problems.push(
      `opening it threw: ${error instanceof Error ? error.message : String(error)}`,
    );
    return finish();
  } finally {
    page.off("response", onResponse);
  }
}

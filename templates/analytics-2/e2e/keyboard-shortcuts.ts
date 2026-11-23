import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import { z } from "zod";

import { secondaryFeaturesEnabled } from "../app/components/shell/secondary-features.js";
import { fetchUiAction } from "./ui-capability.js";

export async function checkKeyboardShortcuts(
  page: Page,
  base: string,
): Promise<void> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  try {
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeVisible({ timeout: 30000 });
  } catch (error) {
    const search = page.getByRole("button", { name: "Search", exact: true });
    await writeFile(
      ".tmp/analytics-owner/f01-readiness.json",
      JSON.stringify(
        {
          url: page.url(),
          count: await search.count(),
          visible: await search
            .all()
            .then((items) =>
              Promise.all(items.map((item) => item.isVisible())),
            ),
        },
        null,
        2,
      ),
    );
    await writeFile(
      ".tmp/analytics-owner/f01-readiness.html",
      await page.content(),
    );
    await page.screenshot({ path: ".tmp/analytics-owner/f01-readiness.png" });
    throw error;
  }
  let id: string | undefined;
  const started = new WeakMap<Request, number>();
  const network: Array<{
    path: string;
    method: string;
    status?: number;
    elapsedMs: number | null;
    failure?: string;
  }> = [];
  const requestStarted = (request: Request) => started.set(request, Date.now());
  const relevant = (request: Request) =>
    request.resourceType() === "document" ||
    new URL(request.url()).pathname.includes("/_agent-native/actions/");
  const elapsed = (request: Request) => {
    const start = started.get(request);
    return start === undefined ? null : Date.now() - start;
  };
  const responseReceived = (response: Response) => {
    const request = response.request();
    if (!relevant(request)) return;
    network.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      status: response.status(),
      elapsedMs: elapsed(request),
    });
  };
  const requestFailed = (request: Request) => {
    if (!relevant(request)) return;
    network.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      elapsedMs: elapsed(request),
      failure: request.failure()?.errorText ?? "unknown",
    });
  };
  page.on("request", requestStarted);
  page.on("response", responseReceived);
  page.on("requestfailed", requestFailed);
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const filter = dialog.getByRole("textbox", { name: "Filter shortcuts..." });
  try {
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("Alt+Shift+l");
    const collection = page.getByRole("dialog", {
      name: "Create new collection",
    });
    await expect(collection).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("Alt+Shift+c");
    if (secondaryFeaturesEnabled()) {
      await expect(
        page.getByRole("dialog", { name: "New component" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
    } else {
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await page.keyboard.press("ControlOrMeta+p");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await palette.screenshot({
      path: ".tmp/analytics-owner/report-command-palette.png",
    });
    const commandFilter = palette.getByRole("combobox");
    await expect(commandFilter).toBeFocused();
    await commandFilter.fill("Go to: Projects");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/home\/all$/);
    await expect(palette).toHaveCount(0);
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Shift+/");
    await expect(dialog).toBeVisible();
    await expect(filter).toBeFocused();
    await dialog.screenshot({
      path: resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../.tmp/analytics-owner/report-keyboard-shortcuts.png",
      ),
    });
    await page.keyboard.press("ControlOrMeta+k");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Search your workspace" }),
    ).toHaveCount(0);
    await filter.fill("workspace");
    await expect(dialog.getByText("Open Workspace search")).toBeVisible();
    await expect(dialog.getByText("Run the cell")).toHaveCount(0);
    await filter.fill("no such shortcut");
    await expect(
      dialog.getByText("No shortcuts match that filter"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const creationResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          "/_agent-native/actions/create-project",
        ),
    );
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("Alt+Shift+n");
    const created = await creationResponse;
    expect(created.ok()).toBe(true);
    id = z.object({ id: z.string().min(1) }).parse(await created.json()).id;
    console.log(`CREATED project ${id}`);
    await page.goto(`${base}/project/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    const help = page.getByRole("button", { name: "Help & support" });
    await expect(help).toBeVisible();
    const title = page.getByRole("button", {
      name: "Project options",
      exact: true,
    });
    await title.click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const titleField = page.getByRole("textbox", {
      name: "Project title",
      exact: true,
    });
    await expect(titleField).toBeFocused();
    await page.keyboard.press("ControlOrMeta+k");
    await expect(
      page.getByRole("dialog", { name: "Search your workspace" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    await page.keyboard.press("ControlOrMeta+Shift+/");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("ControlOrMeta+p");
    await expect(palette).toBeVisible();
    await commandFilter.fill("Toggle left sidebar");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("navigation", { name: "Workspace tools" }),
    ).toBeHidden();
    await page.keyboard.press("Alt+Shift+Backquote");
    await expect(
      page.getByRole("navigation", { name: "Workspace tools" }),
    ).toBeVisible();
    await help.click();
    const opener = page.getByRole("button", { name: "Keyboard shortcuts" });
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(filter).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    const added = await page.request.post(
      `${base}/_agent-native/actions/add-project-cell`,
      { headers, data: { projectId: id, kind: "sql" } },
    );
    expect(added.ok()).toBe(true);
    const { createdCellId } = z
      .object({ createdCellId: z.string().min(1) })
      .parse(await added.json());
    await page.reload({ waitUntil: "domcontentloaded" });
    const cell = page.locator(`[data-notebook-cell="${createdCellId}"]`);
    await expect(cell).toBeVisible();
    await cell.focus();
    await page.keyboard.press("ControlOrMeta+Shift+m");
    await expect(page.locator(".ws-agent-notebook")).toBeVisible();
  } catch (error) {
    const help = page.getByRole("button", { name: "Help & support" });
    const captures = await Promise.allSettled([
      (async () =>
        writeFile(
          ".tmp/analytics-owner/f01-project-failure.json",
          JSON.stringify(
            {
              url: page.url(),
              helpCount: await help.count(),
              helpVisible: await help.first().isVisible(),
              network,
            },
            null,
            2,
          ),
        ))(),
      page
        .content()
        .then((html) =>
          writeFile(".tmp/analytics-owner/f01-project-failure.html", html),
        ),
      page.screenshot({ path: ".tmp/analytics-owner/f01-project-failure.png" }),
    ]);
    const failedCaptures = captures.flatMap((result, index) =>
      result.status === "rejected" ? [index] : [],
    );
    if (failedCaptures.length)
      console.error(
        `F01 diagnostic capture failed: ${failedCaptures.join(",")}`,
      );
    throw error;
  } finally {
    page.off("request", requestStarted);
    page.off("response", responseReceived);
    page.off("requestfailed", requestFailed);
    if (id) {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
      const trashed = await page.request.post(
        `${base}/_agent-native/actions/trash-project`,
        { headers, data: { projectId: id } },
      );
      if (!trashed.ok())
        throw new Error(
          `Could not trash shortcut fixture (${trashed.status()})`,
        );
      const deleted = await fetchUiAction(
        page.request,
        base,
        `${base}/_agent-native/actions/delete-project`,
        { method: "POST", data: { projectId: id } },
      );
      if (!deleted.ok())
        throw new Error(
          `Could not delete shortcut fixture (${deleted.status()})`,
        );
      const readback = await page.request.get(
        `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
        { headers },
      );
      expect(readback.status()).toBe(404);
      console.log(`CLEANUP project ${id} GET404`);
    }
  }
}

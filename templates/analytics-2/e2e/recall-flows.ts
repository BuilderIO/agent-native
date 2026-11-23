import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { publishBrowserFixture } from "./publish-fixture";
import { fetchUiAction, uiActionHeaders } from "./ui-capability";

async function read(page: Page, base: string, action: string) {
  const response = await page.request.get(
    `${base}/_agent-native/actions/${action}`,
    { headers: uiActionHeaders(base) },
  );
  expect(response.ok(), `${action} HTTP ${response.status()}`).toBe(true);
  return response.json();
}

async function post(page: Page, base: string, action: string, data: object) {
  const response = await fetchUiAction(
    page.request,
    base,
    `${base}/_agent-native/actions/${action}`,
    { method: "POST", data },
  );
  expect(response.ok(), `${action} HTTP ${response.status()}`).toBe(true);
  return response.json();
}

/** report 1794899464.159559 */
export async function checkWorkspaceProjects(page: Page, base: string) {
  const shell = z
    .object({
      workspace: z.object({ id: z.string(), name: z.string() }),
      workspaces: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          needsLogin: z.boolean().optional(),
        }),
      ),
    })
    .parse(await read(page, base, "get-workspace-shell"));
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  await page
    .locator(".ws-sidebar")
    .getByRole("button", { name: shell.workspace.name, exact: true })
    .click();
  const rows = page.locator(".ws-workspace-row");
  for (const workspace of shell.workspaces.filter(
    (entry) => !entry.needsLogin,
  )) {
    const row = rows.filter({
      has: page.getByText(workspace.name, { exact: true }),
    });
    await expect(row).toBeVisible();
    await expect(row).toBeEnabled();
  }
  await page.keyboard.press("Escape");
  const projects = page
    .locator(".ws-sidebar")
    .getByRole("link", { name: "Projects", exact: true });
  await expect(projects).not.toHaveAttribute("aria-disabled", "true");
  const list = page.waitForResponse(
    (response) =>
      response.url().includes("/actions/list-projects") && response.ok(),
  );
  void list.catch(() => {});
  await projects.click();
  await list;
  await expect(page).toHaveURL(/\/home\/all$/);
  await expect(
    page.getByRole("heading", { name: "Projects", exact: true }),
  ).toBeVisible();
}

/** report 1794900076.228569 */
export async function checkHomeFocus(page: Page, base: string) {
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  const editor = page.locator(
    '[data-agent-composer-variant="hero"][data-agent-composer-slot="editor-input"]',
  );
  const frame = page.locator(".ws-agent-home .agent-composer-root");
  await expect(editor).toBeVisible();
  const border = await frame.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  const focusAccent = await frame.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--agent-kit-composer-focus-border-color)";
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  async function check() {
    await expect(editor).toBeFocused();
    await expect(editor).toHaveCSS("outline-style", "none");
    await expect(editor).toHaveCSS("box-shadow", "none");
    await expect(frame).toHaveCSS("border-color", border);
    expect(
      await frame.evaluate((element) => getComputedStyle(element).borderColor),
    ).not.toBe(focusAccent);
  }
  await editor.click();
  await check();
  await page.getByRole("button", { name: "Search", exact: true }).focus();
  for (
    let i = 0;
    i < 30 &&
    !(await editor.evaluate((node) => node === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await check();
}

/** report 1794900494.750729 */
export async function checkPopular(page: Page, base: string) {
  const title = `Popular QA ${randomUUID()}`;
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(await post(page, base, "create-project", { title }));
  try {
    await publishBrowserFixture(page, base, id);
    await page.goto(`${base}/app/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page
        .locator('[data-published-app="true"]')
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    const section = page.locator(".ws-home-section").filter({
      has: page.getByRole("heading", {
        name: "Popular projects",
        exact: true,
      }),
    });
    const card = section
      .getByRole("article")
      .filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await expect(card).toBeVisible();
    const trigger = card.getByRole("button", {
      name: "Project information",
      exact: true,
    });
    await trigger.hover();
    const information = page.getByRole("dialog", {
      name: "Project Information",
    });
    await expect(information).toBeVisible();
    for (const label of [
      "Published",
      "Creator",
      "Owner",
      "Created on",
      "Last updated",
    ])
      await expect(information.getByText(label, { exact: true })).toBeVisible();
    const list = z
      .object({
        projects: z.array(
          z.object({
            id: z.string(),
            ownerName: z.string().nullable(),
            creatorName: z.string().nullable(),
            createdAt: z.string(),
            lastEditedAt: z.string(),
            namesUnavailable: z.boolean(),
          }),
        ),
      })
      .parse(await read(page, base, "list-popular-projects"));
    const metadata = list.projects.find((project) => project.id === id);
    if (!metadata)
      throw new Error("Published project is absent from popular list");
    const fallback = metadata.namesUnavailable ? "Name unavailable" : "Unknown";
    for (const [label, value] of [
      ["Creator", metadata.creatorName ?? fallback],
      ["Owner", metadata.ownerName ?? fallback],
    ] as const)
      await expect(
        information.getByText(label, { exact: true }).locator(".."),
      ).toContainText(value);
    const date = (value: string) =>
      new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(value));
    for (const [label, value] of [
      ["Created on", date(metadata.createdAt)],
      ["Last updated", date(metadata.lastEditedAt)],
    ] as const)
      await expect(
        information.getByText(label, { exact: true }).locator(".."),
      ).toContainText(value);
    await page.mouse.move(0, 0);
    await expect(information).toBeHidden();
    await trigger.click();
    await page.mouse.move(0, 0);
    await expect(information).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(information).toBeHidden();
    await section.getByRole("link", { name: "View all", exact: true }).click();
    await expect(page).toHaveURL(/\/home\/all\?sort=popular$/);
    await expect(
      page.getByRole("article").getByRole("link", { name: title, exact: true }),
    ).toBeVisible();
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await post(page, base, "trash-project", { projectId: id });
    await post(page, base, "delete-project", { projectId: id });
    const result = await page.request.get(
      `${base}/_agent-native/actions/get-project`,
      { headers: uiActionHeaders(base), params: { projectId: id } },
    );
    expect(result.status()).toBe(404);
  }
}

/** report 1794913977.330369 */
export async function checkBigQueryDraft(page: Page, base: string) {
  const name = `QA draft ${randomUUID()}`;
  console.log("BIGQUERY DRAFT FIXTURE", name);
  let phase = "open-data";
  let observed: boolean[] | null = null;
  const list = async () => {
    const connections = z
      .object({
        connections: z.array(
          z.object({ id: z.string(), name: z.string(), isDraft: z.boolean() }),
        ),
      })
      .parse(await read(page, base, "list-data-connections")).connections;
    observed = connections
      .filter((entry) => entry.name === name)
      .map((entry) => entry.isDraft);
    return connections;
  };
  let submitted = false;
  try {
    await page.goto(`${base}/home/data`, { waitUntil: "domcontentloaded" });
    phase = "open-picker";
    await page
      .getByRole("button", { name: /^(Add data connection|Connect your data)/ })
      .click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: "Close", exact: true }) })
      .last();
    await dialog
      .getByRole("button", { name: "Google BigQuery", exact: true })
      .click();
    phase = "fill-name";
    await dialog.getByLabel(/^Name/).first().fill(name);
    submitted = true;
    phase = "save-draft";
    await dialog
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    phase = "dialog-close";
    await expect(dialog).toBeHidden({ timeout: 30000 });
    phase = "draft-readback";
    await expect
      .poll(
        async () =>
          (await list())
            .filter((connection) => connection.name === name)
            .map((connection) => connection.isDraft),
        { timeout: 30000 },
      )
      .toEqual([true]);
    phase = "draft-view";
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Failed to load schemas")).toHaveCount(0);
    await expect(
      page.locator('[data-sonner-toast][data-type="error"]'),
    ).toHaveCount(0);
    await expect(
      page.locator(".data-page-tree-status[role=alert]"),
    ).toHaveCount(0);
    await page.goto(`${base}/settings/data-sources`, {
      waitUntil: "domcontentloaded",
    });
    phase = "edit-draft";
    await page
      .getByRole("button", { name: `${name} options`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByLabel(/^Name/).first(),
    ).toHaveValue(name);
    const editDialog = page.getByRole("dialog").last();
    await expect(
      editDialog.getByText(
        'This is a draft data connection. Click "Create connection" to save this as a live data connection.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      editDialog.getByRole("button", {
        name: "Create connection",
        exact: true,
      }),
    ).toBeVisible();
  } catch (error) {
    console.log(
      "BIGQUERY DRAFT DIAGNOSTIC",
      JSON.stringify({ phase, matches: observed }),
    );
    throw error;
  } finally {
    if (submitted) {
      const matches = (await list()).filter(
        (connection) => connection.name === name,
      );
      console.log(
        "BIGQUERY DRAFT CLEANUP",
        JSON.stringify({ matches: matches.length }),
      );
      if (matches.length > 1)
        throw new Error("Draft creation duplicated the fixture");
      if (matches.length === 1) {
        const match = z.object({ id: z.string() }).parse(matches[0]);
        console.log("BIGQUERY DRAFT CLEANUP ID", match.id);
        await page.goto(`${base}/settings/data-sources`, {
          waitUntil: "domcontentloaded",
        });
        await page
          .getByRole("button", { name: `${name} options`, exact: true })
          .click();
        await page
          .getByRole("menuitem", { name: "Delete", exact: true })
          .click();
        const deletion = page
          .waitForResponse((response) => {
            const request = response.request();
            if (
              !new URL(response.url()).pathname.endsWith(
                "/actions/delete-data-connection",
              ) ||
              request.method() !== "POST"
            )
              return false;
            const payload = z
              .object({ id: z.string() })
              .safeParse(request.postDataJSON());
            return payload.success && payload.data.id === match.id;
          })
          .then(
            (response) => ({ response }),
            (error: unknown) => ({ error }),
          );
        await page
          .getByRole("alertdialog", { name: "Confirm delete" })
          .or(page.getByRole("dialog", { name: "Confirm delete" }))
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        const result = await deletion;
        if ("error" in result) {
          if (result.error instanceof Error) throw result.error;
          throw new Error("Draft deletion response unavailable", {
            cause: result.error,
          });
        }
        expect(result.response.ok()).toBe(true);
        expect(
          z
            .object({ id: z.string(), deleted: z.literal(true) })
            .parse(await result.response.json()),
        ).toEqual({ id: match.id, deleted: true });
        await expect
          .poll(async () =>
            (await list()).filter((connection) => connection.name === name),
          )
          .toEqual([]);
        console.log("BIGQUERY DRAFT CLEANUP VERIFIED", name);
      }
    }
  }
}

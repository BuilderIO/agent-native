import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../app/lib/model/contracts.js";
import { fetchUiAction } from "./ui-capability.js";

const preferencesSchema = z.object({
  lineNumbers: z.boolean(),
  fullWidthCells: z.boolean(),
});

export async function checkEditorPreferences(
  page: Page,
  base: string,
  workspaceId: string,
): Promise<void> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (name: string, data?: object) => {
    const response = await fetchUiAction(
      page.request,
      base,
      `${base}/_agent-native/actions/${name}`,
      {
        method: data === undefined ? "GET" : "POST",
        ...(data !== undefined ? { data } : {}),
      },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const shell = z
    .object({
      user: z.object({ email: z.string() }),
      workspace: z.object({ id: z.string() }),
    })
    .parse(await action("get-workspace-shell"));
  expect(shell.user.email).toBe("qa-fleet@builder.io");
  expect(shell.workspace.id).toBe(workspaceId);
  const initialPreferences = preferencesSchema.parse(
    await action("get-editor-preferences"),
  );
  const created = z.object({ id: z.string().min(1) }).parse(
    await action("create-project", {
      title: `Editor preferences ${randomUUID()}`,
    }),
  );
  const readProject = async () => {
    const query = new URLSearchParams({ projectId: created.id });
    return z
      .object({
        project: projectDocumentSchema,
        outputs: z.record(z.string(), z.unknown()),
      })
      .parse(await action(`get-project?${query}`));
  };
  let phase = "create-cells";
  const writes: Array<{
    lineNumbers?: boolean | undefined;
    fullWidthCells?: boolean | undefined;
  }> = [];
  const responses: number[] = [];
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname ===
      "/_agent-native/actions/set-editor-preferences"
    )
      responses.push(response.status());
  });
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname !==
      "/_agent-native/actions/set-editor-preferences"
    )
      return;
    try {
      const input = z
        .object({
          lineNumbers: z.boolean().optional(),
          fullWidthCells: z.boolean().optional(),
        })
        .parse(request.postDataJSON());
      writes.push(input);
    } catch {
      console.error("EDITOR PREFS invalid preference write payload");
    }
  });
  try {
    for (const [kind, text] of [
      ["sql", "SELECT 1 AS first_value\nUNION ALL\nSELECT 2"],
      ["markdown", "# Preference fixture\nSecond line\nThird line"],
    ] as const) {
      const added = z
        .object({
          createdCellId: z.string().min(1),
          project: projectDocumentSchema,
        })
        .parse(
          await action("add-project-cell", { projectId: created.id, kind }),
        );
      const cell = added.project.cells.find(
        (item) => item.id === added.createdCellId,
      );
      if (!cell || cell.contents.kind !== kind)
        throw new Error(`Missing ${kind} cell`);
      const contents =
        kind === "sql"
          ? { ...cell.contents, source: text }
          : { ...cell.contents, markdown: text };
      await action("save-project-cell", {
        projectId: created.id,
        cellId: cell.id,
        contents,
      });
    }
    const before = await readProject();
    const assertUnchangedNotebook = (actual: typeof before) => {
      // Reading the project records a view, so its lastOpenedAt advances.
      const { lastOpenedAt: expectedOpened, ...expectedProject } =
        before.project;
      const { lastOpenedAt: actualOpened, ...actualProject } = actual.project;
      expect(expectedOpened).not.toBeNull();
      expect(actualOpened).not.toBeNull();
      const initialTime = Date.parse(expectedOpened ?? "");
      const actualTime = Date.parse(actualOpened ?? "");
      expect(Number.isFinite(initialTime)).toBe(true);
      expect(Number.isFinite(actualTime)).toBe(true);
      expect(actualTime).toBeGreaterThanOrEqual(initialTime);
      expect(actualProject).toEqual(expectedProject);
      expect(actual.outputs).toEqual(before.outputs);
    };
    expect(before.project.cells.map((cell) => cell.contents.kind)).toEqual([
      "sql",
      "markdown",
    ]);
    const sql = before.project.cells.at(0);
    const markdown = before.project.cells.at(1);
    if (!sql || !markdown) throw new Error("Fixture cells missing");
    await page.setViewportSize({ width: 1800, height: 1100 });
    const settings = `${base}/settings/preferences`;
    const project = `${base}/project/${encodeURIComponent(created.id)}/latest`;
    const setViaUi = async (value: boolean) => {
      await page.goto(settings, { waitUntil: "domcontentloaded" });
      for (const label of ["Line numbers", "Full width Notebook cells"]) {
        const toggle = page.getByRole("switch", { name: label, exact: true });
        await expect(toggle).toBeVisible({ timeout: 30000 });
        await expect(toggle).toBeEnabled({ timeout: 30000 });
        const checkedBefore = await toggle.getAttribute("aria-checked");
        const disabledBefore = await toggle.isDisabled();
        const clicked = checkedBefore !== String(value);
        console.log(
          `EDITOR PREFS before=${label === "Line numbers" ? "lineNumbers" : "fullWidthCells"} desired=${value} checked=${checkedBefore} disabled=${disabledBefore} clicked=${clicked}`,
        );
        if (clicked) await toggle.click();
        await expect(toggle).toHaveAttribute("aria-checked", String(value));
        console.log(
          `EDITOR PREFS toggle=${label === "Line numbers" ? "lineNumbers" : "fullWidthCells"} desired=${value} disabled=${await toggle.isDisabled()}`,
        );
      }
      await expect
        .poll(async () =>
          preferencesSchema.parse(await action("get-editor-preferences")),
        )
        .toEqual({ lineNumbers: value, fullWidthCells: value });
    };
    const openProject = async () => {
      await page.goto(project, { waitUntil: "domcontentloaded" });
      const sqlCell = page.locator(`[data-notebook-cell="${sql.id}"]`);
      const mdCell = page.locator(`[data-notebook-cell="${markdown.id}"]`);
      try {
        await expect(sqlCell).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        await writeFile(
          ".tmp/analytics-owner/prefs-readiness.json",
          JSON.stringify(
            {
              url: page.url(),
              cellCount: await sqlCell.count(),
              visible: await sqlCell.isVisible(),
            },
            null,
            2,
          ),
        );
        await writeFile(
          ".tmp/analytics-owner/prefs-readiness.html",
          await page.content(),
        );
        await page.screenshot({
          path: ".tmp/analytics-owner/prefs-readiness.png",
        });
        throw error;
      }
      await expect(mdCell).toBeVisible();
      await expect(sqlCell.locator(".cm-line")).toHaveText([
        "SELECT 1 AS first_value",
        "UNION ALL",
        "SELECT 2",
      ]);
      await expect(mdCell).toContainText("Preference fixture");
      return { sqlCell, mdCell };
    };
    phase = "initial-off";
    await setViaUi(false);
    let cells = await openProject();
    await expect(cells.sqlCell.locator(".cm-lineNumbers")).toHaveCount(0);
    await cells.mdCell.getByRole("button", { name: /^Edit / }).click();
    await expect(cells.mdCell.locator("textarea")).toHaveValue(
      "# Preference fixture\nSecond line\nThird line",
    );
    await expect(cells.mdCell.locator(".nb-line-numbers")).toHaveCount(0);
    const narrowSql = await cells.sqlCell.boundingBox();
    const narrowMarkdown = await cells.mdCell.boundingBox();
    if (!narrowSql || !narrowMarkdown)
      throw new Error("Narrow cell geometry unavailable");
    phase = "enable";
    await setViaUi(true);
    cells = await openProject();
    await expect(
      cells.sqlCell.locator(".cm-lineNumbers .cm-gutterElement:visible"),
    ).toHaveText(["1", "2", "3"]);
    await cells.mdCell.getByRole("button", { name: /^Edit / }).click();
    await expect(cells.mdCell.locator(".nb-line-numbers > div")).toHaveText([
      "1",
      "2",
      "3",
    ]);
    const wideSql = await cells.sqlCell.boundingBox();
    const wideMarkdown = await cells.mdCell.boundingBox();
    if (!wideSql || !wideMarkdown)
      throw new Error("Wide cell geometry unavailable");
    expect(wideSql.width).toBeGreaterThan(narrowSql.width);
    expect(wideMarkdown.width).toBeGreaterThan(narrowMarkdown.width);
    phase = "screenshot";
    await page.screenshot({
      path: resolve(
        `.tmp/analytics-owner/report-editor-preferences-${randomUUID()}.png`,
      ),
    });
    phase = "enabled-reload";
    await page.reload();
    await expect(
      cells.sqlCell.locator(".cm-lineNumbers .cm-gutterElement:visible"),
    ).toHaveText(["1", "2", "3"]);
    await cells.mdCell.getByRole("button", { name: /^Edit / }).click();
    await expect(cells.mdCell.locator(".nb-line-numbers > div")).toHaveText([
      "1",
      "2",
      "3",
    ]);
    expect(
      preferencesSchema.parse(await action("get-editor-preferences")),
    ).toEqual({ lineNumbers: true, fullWidthCells: true });
    phase = "enabled-project-readback";
    const enabledReadback = await readProject();
    assertUnchangedNotebook(enabledReadback);
    phase = "disable";
    await setViaUi(false);
    cells = await openProject();
    await expect(cells.sqlCell.locator(".cm-lineNumbers")).toHaveCount(0);
    phase = "disabled-reload";
    await page.reload();
    await expect(cells.sqlCell.locator(".cm-lineNumbers")).toHaveCount(0);
    expect(
      preferencesSchema.parse(await action("get-editor-preferences")),
    ).toEqual({ lineNumbers: false, fullWidthCells: false });
    const restoredSql = await cells.sqlCell.boundingBox();
    const restoredMarkdown = await cells.mdCell.boundingBox();
    phase = "disabled-geometry";
    console.log(
      `EDITOR PREFS widths sql=${restoredSql?.width === narrowSql.width} markdown=${restoredMarkdown?.width === narrowMarkdown.width}`,
    );
    expect(restoredSql?.width).toBe(narrowSql.width);
    expect(restoredMarkdown?.width).toBe(narrowMarkdown.width);
    phase = "disabled-project-readback";
    const disabledReadback = await readProject();
    assertUnchangedNotebook(disabledReadback);
  } catch (error) {
    const persisted = preferencesSchema.safeParse(
      await action("get-editor-preferences"),
    );
    console.error(
      `EDITOR PREFS failed phase=${phase} writes=${JSON.stringify(writes)} responses=${JSON.stringify(responses)} persisted=${persisted.success ? JSON.stringify(persisted.data) : "unreadable"}`,
    );
    throw error;
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await action("set-editor-preferences", initialPreferences);
    expect(
      preferencesSchema.parse(await action("get-editor-preferences")),
    ).toEqual(initialPreferences);
    await action("trash-project", { projectId: created.id });
    await action("delete-project", { projectId: created.id });
    const response = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: created.id })}`,
      { headers },
    );
    expect(response.status()).toBe(404);
  }
}

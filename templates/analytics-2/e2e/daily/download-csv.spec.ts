import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures";

test("report A2-CSV-FORMULA-EXPORT protects formula text and headers while preserving numbers", async ({
  daily,
}) => {
  const project = await daily.createProject();
  await daily.open(`/project/${encodeURIComponent(project.id)}/latest`);
  await daily.page
    .getByRole("button", { name: "Query", exact: true })
    .first()
    .click();
  const cell = daily.page.locator("[data-notebook-cell]").first();
  await cell.getByRole("button", { name: /^Data connection:/ }).click();
  await daily.page
    .getByRole("menu", { name: "Data connections" })
    .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
    .click();
  const editor = cell.getByRole("textbox", { name: /^Edit SQL/ });
  await editor.fill(
    `SELECT '=1+2' AS "=x", -2 AS amount, ' +cmd' AS spaced, 'a,"b"' AS quoted FROM orders LIMIT 1`,
  );
  await editor.press("ControlOrMeta+Enter");
  await expect(cell.locator("tbody tr").first().locator("td")).toHaveText(
    ["=1+2", "-2", " +cmd", 'a,"b"'],
    { timeout: 30_000 },
  );
  const downloadPromise = daily.page.waitForEvent("download");
  await cell.getByRole("button", { name: /download.*csv/i }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("CSV download did not produce a file");
  expect(await readFile(path, "utf8")).toBe(
    `'=x,amount,spaced,quoted\r\n'=1+2,-2,' +cmd,"a,""b"""\r\n`,
  );
  await daily.check();
});

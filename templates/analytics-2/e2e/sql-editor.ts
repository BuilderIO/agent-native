import { expect, type Locator, type Page } from "@playwright/test";

export const sqlEditor = (page: Page) =>
  page.locator(
    "[data-notebook-cell] .nb-sql-editor .cm-content, [data-notebook-cell] textarea.nb-cell-source",
  );

export async function readSqlEditor(editor: Locator): Promise<string> {
  return editor.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    const lines = element.querySelectorAll(":scope > .cm-line");
    if (lines.length === 0) throw new Error("SQL editor has no readable lines");
    return Array.from(lines, (line) => line.textContent).join("\n");
  });
}

export async function writeSqlEditor(editor: Locator, source: string) {
  await editor.click();
  await editor.press("ControlOrMeta+a");
  if (source) await editor.page().keyboard.insertText(source);
  else await editor.press("Backspace");
  await expect.poll(() => readSqlEditor(editor)).toBe(source);
}

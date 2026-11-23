import type { Locator, Response } from "@playwright/test";

import { editorOf } from "../daily/notebook.helpers.js";

export async function pressSqlRun(
  cell: Locator,
  admission: () => Promise<Response>,
) {
  await cell
    .getByRole("button", { name: /^Run SQL\b/ })
    .click({ trial: true, timeout: 30_000 });
  const [receipt] = await Promise.all([
    admission(),
    editorOf(cell).press("ControlOrMeta+Enter"),
  ]);
  return receipt;
}

export async function fillAppLayoutGap(
  chartMenu: Pick<Locator, "click">,
  moveLeft: Pick<Locator, "click">,
  chartWidth: Pick<Locator, "click" | "press">,
  steps: number,
) {
  for (let step = 0; step < steps; step++) {
    await chartMenu.click();
    await moveLeft.click();
  }
  for (let step = 0; step < steps; step++) {
    await chartWidth.click({ trial: true });
    await chartWidth.press("ArrowRight");
  }
}

// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import notebookStyles from "./notebook.css?inline";

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

it("keeps the add-cell control beside an input cell square, not row-wide", () => {
  const style = document.createElement("style");
  style.textContent = notebookStyles;
  document.head.append(style);
  document.body.innerHTML = `<div class="nb-cell-slot"><div class="nb-cell"></div><button class="nb-insert-button"></button></div><div class="nb-cell-slot"><div class="nb-cell"></div><div class="nb-insert"><button class="nb-insert-button" id="gap"></button></div></div>`;
  const beside = document.querySelector(
    ".nb-cell-slot > .nb-insert-button",
  ) as HTMLElement;
  expect(getComputedStyle(beside).width).toBe("28px");
  expect(getComputedStyle(beside).height).toBe("28px");
  const gap = document.getElementById("gap") as HTMLElement;
  expect(getComputedStyle(gap).width).toBe("calc(100% - 100px)");
});

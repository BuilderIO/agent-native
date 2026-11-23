// @vitest-environment happy-dom
import { expect, it } from "vitest";

import globalStyles from "./global.css?raw";

it("the published app scroller is styled by the always-loaded global stylesheet", () => {
  const style = document.createElement("style");
  style.textContent = globalStyles;
  document.head.append(style);
  const main = document.createElement("main");
  main.className = "app-session-page";
  document.body.append(main);
  expect(getComputedStyle(main).overflowY).toBe("auto");
  main.remove();
  style.remove();
});

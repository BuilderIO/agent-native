// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";

import { releaseStaleBodyLock, releaseStaleFocus } from "./dialog.js";

afterEach(() => {
  document.body.innerHTML = "";
  document.body.style.pointerEvents = "";
});

it.each(["menu", "dialog", "listbox"])(
  "preserves focus on a trigger for a closed %s",
  (kind) => {
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-haspopup", kind);
    trigger.setAttribute("data-state", "closed");
    document.body.append(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    releaseStaleBodyLock();
    expect(document.activeElement).toBe(trigger);
  },
);

it("preserves focus on a tooltip trigger with no popup attribute", () => {
  const trigger = document.createElement("button");
  trigger.setAttribute("data-state", "closed");
  document.body.append(trigger);
  trigger.focus();
  releaseStaleFocus();
  expect(document.activeElement).toBe(trigger);
});

it("still releases a trigger inside an actual closed layer", () => {
  const layer = document.createElement("div");
  layer.setAttribute("role", "menu");
  layer.setAttribute("data-state", "closed");
  const trigger = document.createElement("button");
  trigger.setAttribute("data-state", "closed");
  trigger.setAttribute("aria-haspopup", "menu");
  layer.append(trigger);
  document.body.append(layer);
  trigger.focus();
  releaseStaleFocus();
  expect(document.activeElement).toBe(document.body);
});

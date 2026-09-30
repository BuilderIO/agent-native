// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";

import {
  startInPlaceTextSession,
  type InPlaceTextSession,
} from "./in-place-text-session";

let session: InPlaceTextSession | null = null;

afterEach(() => {
  session?.end();
  session = null;
  document.body.replaceChildren();
});

it("does not persist slash-menu ARIA through root retag, undo, and session end", () => {
  const element = document.createElement("p");
  element.setAttribute("aria-haspopup", "grid");
  element.setAttribute("aria-label", "Details");
  element.textContent = "Alpha";
  document.body.append(element);
  const textSession = startInPlaceTextSession(element);
  session = textSession;

  const text = element.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, 2);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  for (const [name, value] of Object.entries({
    "aria-haspopup": "listbox",
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-controls": "slide-slash-command-list",
    "aria-activedescendant": "slide-slash-heading1",
  })) {
    element.setAttribute(name, value);
  }

  expect(textSession.commands.applyAuthoringCommand("heading1")).toBe(true);
  expect(textSession.undo()).toBe(true);
  textSession.end();

  expect(textSession.element.tagName).toBe("P");
  expect(textSession.element.getAttribute("aria-haspopup")).toBe("grid");
  expect(textSession.element.getAttribute("aria-label")).toBe("Details");
  expect(
    Array.from(textSession.element.attributes, (attribute) => attribute.name)
      .filter((name) => name.startsWith("aria-"))
      .sort(),
  ).toEqual(["aria-haspopup", "aria-label"]);
});

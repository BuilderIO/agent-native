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

function pasteAtEnd(host: string, html: string, plainText: string) {
  document.body.innerHTML = `<div class="slide-content"><div class="fmd-slide">${host}</div></div>`;
  const el = document.querySelector<HTMLElement>("#t")!;
  session = startInPlaceTextSession(el);
  const text = document
    .createTreeWalker(el, NodeFilter.SHOW_TEXT)
    .nextNode() as Text;
  const range = document.createRange();
  range.setStart(text, text.length);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const clipboardData = new DataTransfer();
  clipboardData.setData("text/html", html);
  clipboardData.setData("text/plain", plainText);
  el.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData,
      bubbles: true,
      cancelable: true,
    }),
  );
  const result = session.element;
  session.end();
  session = null;
  return result;
}

const paragraph = (text: string) =>
  `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000">${text}</span></p>`;
const googleDocsParagraphs = `<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-x">${paragraph("Line one")}${paragraph("Line two")}</b><br class="Apple-interchange-newline">`;
const googleDocsList =
  '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-x"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;">Item A</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;" aria-level="1"><p dir="ltr" role="presentation"><span style="font-size:11pt;">Item B</span></p></li></ul></b>';

it("keeps Google Docs paragraphs separate through live paste and save", () => {
  const element = pasteAtEnd(
    '<div id="t">Start </div>',
    googleDocsParagraphs,
    "Line one\nLine two",
  );
  expect(element.querySelectorAll("br")).toHaveLength(1);
  expect(element.querySelector('b[style*="font-weight: normal"]')).toBeNull();
  expect(element.innerHTML).toContain("Line one</span><br><span>Line two");
});

it("keeps Google Docs list items through live paste into a slide", () => {
  const element = pasteAtEnd(
    '<div id="t">Start </div>',
    googleDocsList,
    "Item A\nItem B",
  );
  expect(element.querySelectorAll("ul > li")).toHaveLength(2);
  expect(
    Array.from(element.querySelectorAll("li"), (li) => li.textContent),
  ).toEqual(["Item A", "Item B"]);
  expect(element.querySelector('b[style*="font-weight: normal"]')).toBeNull();
});

it("keeps Google Docs list items when pasted inside a list item", () => {
  const element = pasteAtEnd(
    '<ul><li id="t">Start </li></ul>',
    googleDocsList,
    "Item A\nItem B",
  );
  expect(element.querySelectorAll("ul > li")).toHaveLength(2);
  expect(
    Array.from(element.querySelectorAll("li"), (li) => li.textContent),
  ).toEqual(["Start ", "Item A", "Item B"]);
  expect(element.querySelector('b[style*="font-weight: normal"]')).toBeNull();
});

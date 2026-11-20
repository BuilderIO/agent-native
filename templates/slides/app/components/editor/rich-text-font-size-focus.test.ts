// @vitest-environment jsdom
import { expect, it } from "vitest";

import { applyInlineFontSizeDelta } from "./rich-text-selection";

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected a non-null test value");
  return value;
}

it("repeatedly resizes a saved mixed range without taking input focus", () => {
  const block = document.createElement("div");
  block.contentEditable = "true";
  block.innerHTML =
    '<span style="font-size: 20px">first</span><span style="font-size: 30px">second</span>';
  document.body.append(block);
  const firstRun = required(block.children[0]);
  const lastRun = required(block.children[1]);
  const first = firstRun.firstChild as Text;
  const last = lastRun.firstChild as Text;
  const saved = document.createRange();
  saved.setStart(first, 1);
  saved.setEnd(last, 3);
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();

  const one = applyInlineFontSizeDelta(
    block,
    1,
    { min: 10, max: 40 },
    null,
    saved,
  );
  expect(one.scope).toBe("selection");
  expect(one.changed).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(one.range?.toString()).toBe("irstsec");

  const two = applyInlineFontSizeDelta(
    block,
    1,
    { min: 10, max: 40 },
    null,
    one.range,
  );
  expect(two.changed).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(two.range?.toString()).toBe("irstsec");
  expect(
    (required(firstRun.lastElementChild) as HTMLElement).style.fontSize,
  ).toBe("22px");
  expect(
    (required(lastRun.firstElementChild) as HTMLElement).style.fontSize,
  ).toBe("32px");
  block.remove();
  input.remove();
});

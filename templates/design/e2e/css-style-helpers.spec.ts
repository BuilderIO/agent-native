import { expect, test } from "@playwright/test";

import { normalizedStyle } from "./css-style-helpers";

test("normalizes independent declaration order and equivalent CSSOM color forms", async ({
  page,
}) => {
  await page.setContent("<!doctype html><html><body></body></html>");

  const first = await normalizedStyle(
    page,
    'width: 120px !important; color: /* green */ #00ff00; margin: 1px 2px; --note: "a; b:c"; background-image: url("data:text/plain;a:b");',
  );
  const reordered = await normalizedStyle(
    page,
    'background-image: url("data:text/plain;a:b"); --note: "a; b:c"; margin: 1px 2px; color: rgb(0, 255, 0); width: 120px !important;',
  );

  expect(first).toEqual(reordered);
  expect(first).toEqual(
    expect.arrayContaining([
      ["width", "120px", "important", "120px"],
      ["color", "rgb(0, 255, 0)", "", "rgb(0, 255, 0)"],
      ["margin-top", "1px", "", "1px"],
      ["margin-right", "2px", "", "2px"],
      ["margin-bottom", "1px", "", "1px"],
      ["margin-left", "2px", "", "2px"],
    ]),
  );
});

test("preserves cascade order when physical and logical margins overlap", async ({
  page,
}) => {
  await page.setContent("<!doctype html><html><body></body></html>");

  const physicalThenLogical = await normalizedStyle(
    page,
    "margin-left: 10px; margin-inline-start: 20px;",
  );
  const logicalThenPhysical = await normalizedStyle(
    page,
    "margin-inline-start: 20px; margin-left: 10px;",
  );
  const longhandThenShorthand = await normalizedStyle(
    page,
    "margin-left: 10px; margin: 0;",
  );
  const shorthandThenLonghand = await normalizedStyle(
    page,
    "margin: 0; margin-left: 10px;",
  );

  expect(physicalThenLogical).not.toEqual(logicalThenPhysical);
  expect(longhandThenShorthand).not.toEqual(shorthandThenLonghand);
  expect(physicalThenLogical).toContainEqual([
    "margin-left",
    "10px",
    "",
    "20px",
  ]);
  expect(logicalThenPhysical).toContainEqual([
    "margin-left",
    "10px",
    "",
    "10px",
  ]);
});

test("preserves order-sensitive all declarations", async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>");

  const displayThenAll = await normalizedStyle(
    page,
    "display: block; all: initial;",
  );
  const allThenDisplay = await normalizedStyle(
    page,
    "all: initial; display: block;",
  );

  expect(displayThenAll).not.toEqual(allThenDisplay);
});

test("rejects nonempty declarations that CSSOM does not support", async ({
  page,
}) => {
  await page.setContent("<!doctype html><html><body></body></html>");

  await expect(normalizedStyle(page, "width: not-a-width;")).rejects.toThrow(
    /Unsupported CSS declaration/,
  );
  await expect(
    normalizedStyle(page, "color: red; width: not-a-width;"),
  ).rejects.toThrow(/Unsupported CSS declaration/);
});

test("preserves quoted and escaped important text in custom properties", async ({
  page,
}) => {
  await page.setContent("<!doctype html><html><body></body></html>");
  const declarations = await normalizedStyle(
    page,
    String.raw`--quoted: "literal !important"; --escaped: \!important; --priority: "literal" !important;`,
  );
  expect(declarations).toContainEqual([
    "--quoted",
    '"literal !important"',
    "",
    '"literal !important"',
  ]);
  expect(declarations).toContainEqual([
    "--escaped",
    String.raw`\!important`,
    "",
    String.raw`\!important`,
  ]);
  expect(declarations).toContainEqual([
    "--priority",
    '"literal"',
    "important",
    '"literal"',
  ]);
});

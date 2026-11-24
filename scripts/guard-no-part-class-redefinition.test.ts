import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findPartClassRedefinitions,
  isInScope,
} from "./guard-no-part-class-redefinition.ts";

const RESERVED = new Set(["button", "menu-item", "dialog-popup"]);
const FILE = "templates/mail/app/global.css";

function flagged(source: string, added: number[] | null = null) {
  return findPartClassRedefinitions(
    FILE,
    source,
    added === null ? null : new Set(added),
    RESERVED,
  ).map((finding) => `${finding.line}:${finding.className}`);
}

void describe("part class redefinition detection", () => {
  void it("flags a part class as the subject, a descendant, or inside :is()", () => {
    const source = [
      ".button { color: red; }",
      ".sidebar .menu-item:hover { background: none; }",
      ":is(.panel, .dialog-popup) { padding: 0; }",
      ".toolbar > .button[data-size='sm'] { height: 20px; }",
    ].join("\n");
    assert.deepEqual(flagged(source), [
      "1:button",
      "2:menu-item",
      "3:dialog-popup",
      "4:button",
    ]);
  });

  void it("does not flag look-alike classes, values, strings or comments", () => {
    const source = [
      ".button-row { display: flex; }",
      ".mail-button { color: red; }",
      ".x { content: '.button'; background: url(./button.png); }",
      "/* .button { } */ .y { color: red; }",
      '[data-label=".button"] { color: red; }',
      ".menu-items { gap: 4px; }",
    ].join("\n");
    assert.deepEqual(flagged(source), []);
  });

  void it("only flags selectors on lines this branch added", () => {
    const source = [
      ".button { color: red; }",
      ".menu-item { color: blue; }",
    ].join("\n");
    assert.deepEqual(flagged(source, [2]), ["2:menu-item"]);
    assert.deepEqual(flagged(source, []), []);
  });

  void it("checks a selector list split over lines when any of its lines was added", () => {
    const source = [".card,", ".button {", "  color: red;", "}"].join("\n");
    assert.deepEqual(flagged(source, [1]), ["1:button"]);
  });

  void it("skips at-rule preludes but checks the rules inside them", () => {
    const source = [
      "@media (max-width: 600px) {",
      "  .button { width: 100%; }",
      "}",
    ].join("\n");
    assert.deepEqual(flagged(source), ["2:button"]);
  });

  void it("accepts a reasoned opt-out and rejects a bare one", () => {
    const reasoned = [
      "/* guard:allow-part-class print stylesheet hides every control */",
      ".button { display: none; }",
    ].join("\n");
    const bare = [
      "/* guard:allow-part-class ok */",
      ".button { display: none; }",
    ].join("\n");
    assert.deepEqual(flagged(reasoned), []);
    assert.deepEqual(flagged(bare), ["2:button"]);
  });

  void it("scopes to app and package stylesheets outside the design system", () => {
    assert.equal(isInScope("templates/mail/app/global.css"), true);
    assert.equal(isInScope("packages/toolkit/src/editor.css"), true);
    assert.equal(
      isInScope("packages/design-system/css/parts/button.css"),
      false,
    );
    assert.equal(isInScope("packages/toolkit/.storybook/storybook.css"), false);
    assert.equal(isInScope("packages/toolkit/dist/styles.css"), false);
    assert.equal(isInScope("templates/mail/app/routes/inbox.tsx"), false);
  });
});

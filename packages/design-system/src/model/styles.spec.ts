// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  applyRowLocators,
  captureRowStyles,
  compareRowStyles,
} from "./styles.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("applyRowLocators", () => {
  it("tags one element per locator and reports missing and ambiguous ones", () => {
    document.body.innerHTML = `
      <ul class="folders">
        <li class="folder" data-name="inbox">Inbox</li>
        <li class="folder" data-name="sent">Sent</li>
      </ul>`;
    const report = applyRowLocators(document, [
      { rowId: "sidebar.nav.inbox", selector: '.folder[data-name="inbox"]' },
      { rowId: "sidebar.nav.drafts", selector: '.folder[data-name="drafts"]' },
      { rowId: "sidebar.nav.any", selector: ".folder" },
    ]);
    expect(report).toEqual({
      tagged: ["sidebar.nav.inbox"],
      missing: ["sidebar.nav.drafts"],
      ambiguous: ["sidebar.nav.any"],
    });
    expect(document.querySelectorAll("[data-rid]")).toHaveLength(1);
  });
});

describe("compareRowStyles", () => {
  it("compares a target with its source row by row", () => {
    document.body.innerHTML = `
      <div data-rid="sidebar.nav.inbox" style="height: 28px; color: rgb(10, 10, 10)">Inbox</div>
      <div data-rid="sidebar.nav.sent" style="height: 28px">Sent</div>`;
    const source = captureRowStyles(document);
    document.body.innerHTML = `
      <div data-rid="sidebar.nav.inbox" style="height: 32px; color: rgb(10, 10, 10)">Inbox</div>`;
    const target = captureRowStyles(document);

    const report = compareRowStyles(source, target, ["height", "color"]);
    expect(report.compared).toBe(1);
    expect(report.missing).toEqual(["sidebar.nav.sent"]);
    expect(report.differences).toEqual([
      {
        rowId: "sidebar.nav.inbox",
        property: "height",
        source: "28px",
        target: "32px",
      },
    ]);
  });

  it("refuses a capture that renders a row twice", () => {
    document.body.innerHTML = `
      <div data-rid="sidebar.nav.inbox"></div>
      <div data-rid="sidebar.nav.inbox"></div>`;
    expect(() => captureRowStyles(document)).toThrow(/rendered twice/);
  });
});

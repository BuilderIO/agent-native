// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import { databaseRowOpenTargetAt } from "./row-open-target";

function draw(html: string) {
  document.body.innerHTML = html;
}

const at = (selector: string) =>
  databaseRowOpenTargetAt(document.querySelector(selector));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("what a press on a row acts on", () => {
  it("names the row for a marked title and for what's drawn inside it", () => {
    draw(
      `<button id="title" data-database-row-open="row-1"><span id="text">Plan</span></button>`,
    );
    expect(at("#title")?.documentId).toBe("row-1");
    expect(at("#text")?.documentId).toBe("row-1");
  });

  it("names the card for a press on its blank space", () => {
    draw(
      `<div id="card" data-database-row-open="row-1"><p id="note">Note</p></div>`,
    );
    expect(at("#note")?.element.id).toBe("card");
  });

  it("leaves a card's own controls to act for themselves", () => {
    draw(`
      <div data-database-row-open="row-1">
        <button id="menu"><svg id="icon"></svg></button>
        <a id="link" href="/x">Link</a>
        <input id="field" />
        <div role="menuitem" id="item">Item</div>
      </div>
    `);
    for (const selector of ["#menu", "#icon", "#link", "#field", "#item"]) {
      expect(at(selector)).toBeNull();
    }
  });

  it("prefers the title's own row to the card around it", () => {
    draw(`
      <div data-database-row-open="row-1">
        <button id="title" data-database-row-open="row-2">Plan</button>
      </div>
    `);
    expect(at("#title")?.documentId).toBe("row-2");
  });

  it("has nothing to say about the rest of the page", () => {
    draw(`<td id="cell">Value</td>`);
    expect(at("#cell")).toBeNull();
    expect(databaseRowOpenTargetAt(null)).toBeNull();
    expect(databaseRowOpenTargetAt(window)).toBeNull();
  });
});

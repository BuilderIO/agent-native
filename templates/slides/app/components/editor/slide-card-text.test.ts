// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { QUARTERLY_DECK } from "../../../server/lib/deck-templates/a-quarterly";
import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";
import {
  firstSeparateTextRun,
  selectAllEditableText,
  selectEntryEditableText,
} from "./rich-text-selection";
import { press, installSelectionModify, type } from "./rte-test-utils";
import { findSmartBlock } from "./slide-text-targets";

let session: InPlaceTextSession | null = null;

beforeAll(() => {
  installSelectionModify();
});

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
});

/** The first KPI card of the QBR scorecard slide, mounted as the canvas holds it. */
function scorecardCard() {
  const scorecard = QUARTERLY_DECK.slides.at(1);
  if (!scorecard) throw new Error("the QBR template has no scorecard slide");
  document.body.innerHTML = `<div class="slide-content">${scorecard.content}</div>`;
  const root = document.querySelector<HTMLElement>(".slide-content");
  const label = Array.from(document.querySelectorAll("span")).find(
    (span) => span.textContent === "Revenue",
  );
  const card = label?.parentElement;
  if (!root || !card) throw new Error("no KPI card in the scorecard");
  return { root, card };
}

const bars = (card: HTMLElement) =>
  Array.from(card.querySelectorAll<HTMLElement>("span")).filter(
    (span) => !span.textContent.trim(),
  ).length;

describe("text inside a KPI card", () => {
  it("is edited as the card, whose text sits in separate boxes", () => {
    const { root, card } = scorecardCard();
    expect(findSmartBlock(card, root)).toBe(card);
    expect(firstSeparateTextRun(card)?.textContent).toBe("Revenue");
  });

  it("starts an Enter edit with only the label selected", () => {
    const { card } = scorecardCard();
    expect(selectEntryEditableText(card)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("Revenue");

    session = startInPlaceTextSession(card);
    type(card, "Sales");
    expect(card.textContent).toContain("Sales$00.0M+0.0%");
    expect(bars(card)).toBe(3);
  });

  it("selects only the label of a card whose value row is a flex box", () => {
    document.body.innerHTML =
      '<div id="kpi"><span>Revenue</span><span style="display:flex"><span style="display:block">$00.0M</span><span style="display:block">+0.0%</span></span></div>';
    const card = document.querySelector<HTMLElement>("#kpi");
    if (!card) throw new Error("no card");
    expect(firstSeparateTextRun(card)?.textContent).toBe("Revenue");
    expect(selectEntryEditableText(card)).toBe(true);
    expect(window.getSelection()?.toString()).toBe("Revenue");
  });

  it("selects all the text of a block whose text flows as one run", () => {
    document.body.innerHTML =
      '<h2 id="t">Plain <span style="color:red">title</span></h2>';
    const heading = document.querySelector<HTMLElement>("#t");
    if (!heading) throw new Error("no heading");
    expect(firstSeparateTextRun(heading)).toBeNull();
    selectEntryEditableText(heading);
    expect(window.getSelection()?.toString()).toBe("Plain title");
  });

  it("keeps the bars and pills when everything is selected and replaced", () => {
    const { card } = scorecardCard();
    const before = bars(card);
    session = startInPlaceTextSession(card);
    selectAllEditableText(card);
    type(card, "X");
    expect(card.textContent).toBe("X");
    expect(bars(card)).toBeGreaterThan(before);
    expect(card.querySelector('[data-trend="auto"]')).not.toBeNull();
    expect(card.querySelector('span[style*="width:92%"]')?.isConnected).toBe(
      true,
    );
  });

  it("keeps the bars when a selection across them is deleted", () => {
    const { card } = scorecardCard();
    session = startInPlaceTextSession(card);
    selectAllEditableText(card);
    press(card, "Backspace");
    // The emptied label holds the session's zero-width caret placeholder.
    expect(card.textContent.replaceAll("\u200b", "")).toBe("");
    expect(card.querySelector('span[style*="width:92%"]')?.isConnected).toBe(
      true,
    );
  });
});

// @vitest-environment happy-dom

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";
import {
  caret,
  installSelectionModify,
  keydown,
  mount,
  paste,
  press,
  restoreGlobals,
  textOf,
  type,
} from "./rte-test-utils";

let session: InPlaceTextSession | null = null;

beforeAll(() => {
  installSelectionModify();
});

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
});

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
  restoreGlobals();
});

const MIXED =
  "<h2>Head</h2><p>Body <b>text</b></p><ul><li>item a</li><li>item b</li></ul><blockquote><p>quoted</p></blockquote>";
const TWO_PARAS = "<p>First paragraph here</p><p>Second paragraph there</p>";

/** Mounts `html` with the caret at the end of the element, as a fresh focus leaves it. */
function boot(html: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  return el;
}

const live = () => session!.element.innerHTML;

/** Cmd+Shift+7 / Cmd+Shift+8: the list toggles are keyed by physical digit. */
function toggleList(kind: "ordered" | "bullet") {
  const digit = kind === "ordered" ? "7" : "8";
  keydown(session!.element, {
    key: digit,
    code: `Digit${digit}`,
    metaKey: true,
    shiftKey: true,
  });
}

/** Undoes everything, then redoes everything; neither direction may throw. */
function replayHistory() {
  while (session!.undo());
  const bottom = live();
  while (session!.redo());
  return { bottom, top: live() };
}

function expectExactHistory(initial: string, top: string) {
  const replayed = replayHistory();
  expect(replayed.bottom).toBe(initial);
  expect(replayed.top).toBe(top);
}

describe("history integrity: a list toggle followed by any edit stays undoable", () => {
  it("keeps undo working when typing follows an ordered toggle", () => {
    boot(MIXED);
    const initial = live();
    toggleList("ordered");
    type(session!.element, "a b");
    expectExactHistory(initial, live());
  });

  it("keeps undo working when Cmd+B follows a bullet toggle", () => {
    boot(MIXED);
    const initial = live();
    toggleList("bullet");
    press(session!.element, "Meta+b");
    expectExactHistory(initial, live());
  });

  it("keeps undo working when Backspace follows an ordered toggle", () => {
    boot(MIXED);
    const initial = live();
    toggleList("ordered");
    caret(textOf(session!.element, "quoted"), 6);
    press(session!.element, "Backspace");
    expectExactHistory(initial, live());
  });

  it("keeps undo working when pasted html follows a bullet toggle", () => {
    boot(MIXED);
    const initial = live();
    toggleList("bullet");
    caret(textOf(session!.element, "quoted"), 6);
    paste(session!.element, {
      "text/html": "<b>bold</b> and <i>it</i>",
      "text/plain": "bold and it",
    });
    expectExactHistory(initial, live());
  });

  it("keeps undo working across markdown shortcuts and a second toggle", () => {
    boot(TWO_PARAS);
    const initial = live();
    toggleList("bullet");
    const first = textOf(session!.element, "First");
    caret(first, 0);
    type(session!.element, "1. ");
    toggleList("ordered");
    type(session!.element, "1. ");
    expectExactHistory(initial, live());
  });
});

describe("history integrity: a list toggle never nests an item in an item", () => {
  it("flattens an existing list into the new list's items", () => {
    boot(MIXED);
    toggleList("ordered");
    expect(session!.element.querySelector("li li")).toBeNull();
    expect(
      Array.from(
        session!.element.querySelectorAll("li"),
        (li) => li.textContent,
      ),
    ).toEqual(["Head", "Body text", "item a", "item b", "quoted"]);
  });

  it("flattens two adjacent lists of different kinds on a toggle", () => {
    boot(
      "<ul><li>First paragraph here</li></ul><ol><li>Second paragraph there</li></ol>",
    );
    toggleList("ordered");
    expect(session!.element.querySelector("li li")).toBeNull();
    expect(session!.element.querySelectorAll("li")).toHaveLength(2);
  });
});

describe("history integrity: undo survives markup that parses into something else", () => {
  it("re-bases the history when a restored state re-serializes differently", () => {
    const el = mount(`<div id="t"><ul><li>one</li></ul><p>two</p></div>`);
    // An li built inside an li serializes to markup the parser reads as siblings.
    el.querySelector("li")!.append(document.createElement("li"));
    session = startInPlaceTextSession(el, {});
    caret(textOf(session.element, "two"), 3);
    press(session.element, "Meta+b");
    type(session.element, "x");
    press(session.element, "Meta+i");
    type(session.element, "y");
    const replayed = replayHistory();
    expect(replayed.bottom).toContain("<li>one</li>");
    expect(replayHistory().top).toBe(replayed.top);
    expect(session!.element.textContent).toContain("twoxy");
  });
});

describe("history integrity: every structural command undoes and redoes exactly", () => {
  const commands: [string, string][] = [
    ["ordered toggle", "toggle:ordered"],
    ["bullet toggle", "toggle:bullet"],
    ["quote", "Meta+Shift+b"],
    ["bold", "Meta+b"],
    ["italic", "Meta+i"],
    ["underline", "Meta+u"],
    ["strike", "Meta+Shift+s"],
    ["code", "Meta+e"],
    ["Enter", "Enter"],
    ["Shift+Enter", "Shift+Enter"],
    ["Tab", "Tab"],
    ["Shift+Tab", "Shift+Tab"],
  ];
  const fixtures: [string, string][] = [
    ["mixed blocks", MIXED],
    ["two paragraphs", TWO_PARAS],
    [
      "a nested list",
      "<ul><li>top<ul><li>child</li></ul></li><li>next</li></ul>",
    ],
  ];

  for (const [fixtureName, html] of fixtures) {
    it.each(commands)(`${fixtureName}: %s`, (_name, chord) => {
      const el = boot(html);
      const initial = live();
      if (chord.startsWith("toggle:")) {
        toggleList(chord.slice(7) as "ordered" | "bullet");
      } else press(el, chord);
      type(session!.element, "z");
      expectExactHistory(initial, live());
    });
  }
});

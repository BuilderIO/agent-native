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
  select,
  show,
  textOf,
  type,
  ZWSP,
} from "./rte-test-utils";

let session: InPlaceTextSession | null = null;

beforeAll(() => {
  installSelectionModify();
});

beforeEach(() => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  // happy-dom has no flex layout: a flex item is blockified in a browser,
  // which is what makes a row's text span its own line box.
  const style = document.createElement("style");
  style.id = "flex-items";
  style.textContent = "#t div > span { display: block; }";
  document.head.append(style);
});

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
  document.getElementById("flex-items")?.remove();
  restoreGlobals();
});

const ROW = 'style="display:flex;gap:12px"';
const BULLET_ROWS =
  '<div style="display:flex;flex-direction:column;gap:12px;font-size:24px">' +
  `<div ${ROW}><span>●</span><span>First point here</span></div>` +
  `<div ${ROW}><span>●</span><span>Second point</span></div>` +
  `<div ${ROW}><span>●</span><span>Third</span></div></div>`;
const STYLED_ROWS =
  '<div style="display:flex;flex-direction:column;gap:10px;font-size:22px">' +
  `<div ${ROW}><span>•</span><span>Revenue <b>up 40%</b> year over year</span></div>` +
  `<div ${ROW}><span>•</span><span style="color:#c33">Costs down</span></div></div>`;
const SHAPE =
  '<span style="width:12px;height:12px;border-radius:50%;background:#2457d6;display:inline-block"></span>';
const SHAPE_ROWS =
  '<div style="display:flex;flex-direction:column;gap:12px;font-size:24px">' +
  `<div ${ROW}>${SHAPE}<span>Alpha beta</span></div>` +
  `<div ${ROW}>${SHAPE}<span>Gamma</span></div></div>`;

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

const slide = () => document.querySelector<HTMLElement>(".fmd-slide")!;
const chord = (name: string) => press(session!.element, name);
const typeText = (text: string) => type(session!.element, text);

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

function pasteHtml(html: string) {
  paste(session!.element, {
    "text/html": html,
    "text/plain": html.replace(/<[^>]+>/g, " "),
  });
}

const plain = (markup: string) => markup.replace(/ style="[^"]*"/g, "");

/** What autosave stores while the session is active. */
function draft() {
  return session!.cloneWithoutPlaceholders(slide()).firstElementChild!;
}

/** What the slide holds once the session has ended. */
function committed() {
  session!.end();
  return slide().firstElementChild!;
}

function emptyInlineWrappers(root: Element) {
  return Array.from(
    root.querySelectorAll("span, b, i, u, strong, em, s, code, a"),
  ).filter((node) => !node.textContent && !node.querySelector("img, br, svg"));
}

/** Both surfaces must be clean: no placeholder, no pending style, no emptied wrapper. */
function expectClean(...documents: Element[]) {
  for (const doc of documents) {
    expect(doc.textContent).not.toContain(ZWSP);
    expect(doc.querySelectorAll("[data-slide-inline-style]")).toHaveLength(0);
    expect(emptyInlineWrappers(doc).map((node) => node.outerHTML)).toEqual([]);
  }
}

describe("a range delete leaves no emptied wrapper behind", () => {
  it("drops the italic run a paste-then-delete emptied", () => {
    boot("<p>Hello brave new world</p>");
    pasteHtml("<b>bold</b> and <i>it</i>");
    expect(session!.element.innerHTML).toContain("<i>it</i>");
    select(
      textOf(session!.element, "bold"),
      0,
      textOf(session!.element, "it"),
      2,
    );
    chord("Backspace");
    const saved = draft();
    expectClean(saved);
    expect(plain(saved.innerHTML)).toBe("<p>Hello brave new world</p>");
    const final = committed();
    expectClean(final);
    expect(plain(final.innerHTML)).toBe("<p>Hello brave new world</p>");
  });

  it("drops the run a paste over a selection emptied", () => {
    boot("<ol><li>one two</li><li>three four</li></ol>");
    pasteHtml("<b>bold</b> and <i>it</i>");
    chord("Meta+a");
    paste(session!.element, { "text/plain": "pasted line" });
    expectClean(draft());
    const final = committed();
    expectClean(final);
    expect(plain(final.innerHTML)).toBe("<ol><li>pasted line</li></ol>");
  });
});

describe("a style toggled at a caret and never used", () => {
  it.each([
    ["Enter", "Meta+u", "<p>plain <b>bold</b> end</p>"],
    ["Meta+i", "Enter", "<p>plain <b>bold</b> end</p>"],
    ["Shift+Enter", "Meta+b", "<ul><li>alpha</li><li>beta</li></ul>"],
  ])("leaves no pending-style span after %s then %s", (first, second, html) => {
    boot(html);
    chord(first);
    chord(second);
    expectClean(draft());
    const final = committed();
    expectClean(final);
    expect(final.innerHTML.startsWith(html)).toBe(true);
  });

  it("hands back the line break typed while the style was pending", () => {
    boot('<div style="font-size:24px">first line<br>second line</div>');
    chord("Meta+u");
    chord("Enter");
    const final = committed();
    expectClean(final);
    expect(plain(final.innerHTML)).toBe(
      "<div>first line<br>second line</div><br><br>",
    );
  });

  it("drops the run Backspace emptied", () => {
    boot("<p>First paragraph here</p><p>Second paragraph there</p>");
    chord("Meta+u");
    chord("Backspace");
    expectClean(draft());
    expectClean(committed());
  });

  it("keeps the style on text typed into it", () => {
    boot("<p>one</p>");
    caret(textOf(session!.element, "one"), 3);
    chord("Meta+u");
    typeText("x");
    const final = committed();
    expect(final.innerHTML).toMatch(
      /^<p>one<span data-slide-inline-style="true"[^>]*>x<\/span><\/p>$/,
    );
  });
});

describe("a draft clone beside emptied text nodes", () => {
  it("cleans the placeholder it belongs to when an empty node precedes it", () => {
    boot("<p>a</p><p>b</p>");
    const paragraphs = session!.element.querySelectorAll("p");
    paragraphs[0].prepend(document.createTextNode(""));
    paragraphs[1].append(document.createTextNode(ZWSP));
    const clone = session!.cloneWithoutPlaceholders(slide());
    expect(clone.textContent).toBe("ab");
  });
});

describe("a line a placeholder holds open", () => {
  it("is a break in the draft, as it is once saved", () => {
    boot("<ol><li>one two</li><li>three four</li></ol>");
    chord("Shift+Enter");
    toggleList("bullet");
    const saved = draft();
    expect(plain(saved.innerHTML)).toBe(
      "<ul><li><ol><li>one two</li><li>three four</li></ol></li><li><br></li></ul>",
    );
    expect(plain(committed().innerHTML)).toBe(plain(saved.innerHTML));
  });

  it("keeps the font of an emptied run as a break in the run", () => {
    boot(
      '<p><span style="font-size:60px">Big</span> <span style="font-size:18px">small text here</span></p>',
    );
    chord("Meta+a");
    chord("Enter");
    const saved = draft();
    expectClean(saved);
    expect(saved.innerHTML).toBe(
      '<p><span style="font-size:60px"><br></span></p><p><span style="font-size:60px"><br></span></p>',
    );
    expect(committed().innerHTML).toBe(saved.innerHTML);
  });

  it("is not a placeholder in the draft of an empty block", () => {
    boot("<ul><li>a</li><li>b</li></ul>");
    caret(textOf(session!.element, "b"), 1);
    chord("Enter");
    chord("Enter");
    const saved = draft();
    expect(saved.textContent).not.toContain(ZWSP);
    expect(plain(saved.innerHTML)).toBe(
      "<ul><li>a</li><li>b</li></ul><p><br></p>",
    );
  });
});

describe("typing over several bullet rows", () => {
  it("lands in the first row's text span", () => {
    boot(BULLET_ROWS);
    chord("Meta+a");
    typeText("Z");
    expect(plain(show(session!.element))).toBe(
      "<div><div><span>●</span><span>Z|</span></div></div>",
    );
    const saved = draft();
    expectClean(saved);
    const final = committed();
    expectClean(final);
    expect(plain(final.innerHTML)).toBe(
      "<div><div><span>●</span><span>Z</span></div></div>",
    );
  });

  it("types a word into the text span", () => {
    boot(BULLET_ROWS);
    chord("Meta+a");
    typeText("Qux");
    expectClean(draft());
    expect(plain(committed().innerHTML)).toBe(
      "<div><div><span>●</span><span>Qux</span></div></div>",
    );
  });

  it("drops the emptied run of the last row, not the first row's", () => {
    boot(STYLED_ROWS);
    chord("Meta+a");
    typeText("Z");
    expectClean(draft());
    expect(plain(committed().innerHTML)).toBe(
      "<div><div><span>•</span><span>Z</span></div></div>",
    );
  });

  it("breaks the line inside the text span", () => {
    boot(BULLET_ROWS);
    chord("Meta+a");
    chord("Shift+Enter");
    expectClean(draft());
    expect(plain(committed().innerHTML)).toBe(
      "<div><div><span>●</span><span><br><br></span></div></div>",
    );
  });

  it("leaves one empty row on Backspace", () => {
    boot(BULLET_ROWS);
    chord("Meta+a");
    chord("Backspace");
    expectClean(draft());
    expect(plain(committed().innerHTML)).toBe(
      "<div><div><span>●</span><span><br></span></div></div>",
    );
  });
});

describe("a markdown shortcut over a selection", () => {
  it("makes a bullet row whose text span holds a break", () => {
    boot('<div style="font-size:24px">first line<br>second line</div>');
    chord("Meta+a");
    typeText("- ");
    expect(plain(show(session!.element))).toBe(
      "<div><div><span>●</span><span>|</span></div></div>",
    );
    const saved = draft();
    expectClean(saved);
    const final = committed();
    expectClean(final);
    expect(plain(final.innerHTML)).toBe(
      "<div><div><span>●</span><span><br></span></div></div>",
    );
  });

  it("makes a bullet row on a new line of a list", () => {
    boot(
      '<ul style="list-style:none;padding:0"><li style="font-size:22px">Revenue up 40%</li></ul>',
    );
    chord("Shift+Enter");
    typeText("- ");
    expectClean(draft());
    expectClean(committed());
  });

  it("makes an ordered item whose style toggle was never used", () => {
    boot(BULLET_ROWS);
    chord("Meta+a");
    typeText("1. ");
    chord("Meta+i");
    expectClean(draft());
    const final = committed();
    expectClean(final);
    expect(plain(final.innerHTML)).toBe(
      "<div><ol><li><span><br></span></li></ol></div>",
    );
  });
});

describe("markup the author wrote empty", () => {
  it("keeps every shape marker through a draft and a save", () => {
    boot(SHAPE_ROWS);
    chord("Shift+Enter");
    chord("Meta+b");
    const saved = draft();
    expect(saved.querySelectorAll('span[style*="border-radius"]')).toHaveLength(
      2,
    );
    const final = committed();
    expect(final.querySelectorAll('span[style*="border-radius"]')).toHaveLength(
      2,
    );
    expect(final.querySelectorAll("[data-slide-inline-style]")).toHaveLength(0);
  });

  it("keeps an empty span the author left between words", () => {
    boot('<p>a<span class="dot"></span> b</p>');
    caret(textOf(session!.element, " b"), 2);
    typeText("c");
    const saved = draft();
    expect(saved.innerHTML).toBe('<p>a<span class="dot"></span> bc</p>');
    expect(committed().innerHTML).toBe('<p>a<span class="dot"></span> bc</p>');
  });

  it("keeps an author zero-width space", () => {
    boot(`<p>A${ZWSP}B</p>`);
    caret(textOf(session!.element, "A"), 3);
    typeText("c");
    expect(draft().innerHTML).toBe(`<p>A${ZWSP}Bc</p>`);
    expect(committed().innerHTML).toBe(`<p>A${ZWSP}Bc</p>`);
  });
});

describe("markup a split copied", () => {
  const ID_SHAPE = SHAPE.replace("<span ", '<span id="m1" data-marker-id="1" ');
  const MARKERS = 'span[style*="border-radius"]';

  it("keeps the marker of a new row split from an identified marker", () => {
    boot(
      `<div style="font-size:24px"><div ${ROW}>${ID_SHAPE}<span>Alpha</span></div></div>`,
    );
    caret(textOf(session!.element, "Alpha"), 5);
    chord("Enter");
    typeText("Beta");
    expect(draft().querySelectorAll(MARKERS)).toHaveLength(2);
    const final = committed();
    expect(final.querySelectorAll(MARKERS)).toHaveLength(2);
    expect(final.querySelectorAll("#m1")).toHaveLength(1);
  });

  it("keeps the marker of a row left empty", () => {
    boot(
      `<div style="font-size:24px"><div ${ROW}>${ID_SHAPE}<span>Alpha</span></div></div>`,
    );
    caret(textOf(session!.element, "Alpha"), 5);
    chord("Enter");
    expect(committed().querySelectorAll(MARKERS)).toHaveLength(2);
  });
});

describe("a delete from the start of a row's text", () => {
  it("removes an image that leads the text", () => {
    boot(
      `<div style="font-size:24px"><div ${ROW}><span>●</span><span><img src="a.png">First point</span></div>` +
        `<div ${ROW}><span>●</span><span>Second</span></div></div>`,
    );
    chord("Meta+a");
    chord("Backspace");
    const final = committed();
    expect(final.querySelector("img")).toBeNull();
    expect(plain(final.innerHTML)).toBe(
      "<div><div><span>●</span><span><br></span></div></div>",
    );
  });

  it("is replaced by what is typed when a break leads the text", () => {
    boot(
      `<div style="font-size:24px"><div ${ROW}><span>●</span><span><br>First point</span></div>` +
        `<div ${ROW}><span>●</span><span>Second</span></div></div>`,
    );
    chord("Meta+a");
    typeText("Z");
    expect(plain(committed().innerHTML)).toBe(
      "<div><div><span>●</span><span>Z</span></div></div>",
    );
  });
});

describe("an emptied wrapper beside an authored empty one", () => {
  it("drops an emptied superscript", () => {
    boot("<p>x <sup>2</sup></p>");
    select(textOf(session!.element, "2"), 0, textOf(session!.element, "2"), 1);
    chord("Backspace");
    expectClean(draft());
    expect(committed().innerHTML).toBe("<p>x </p>");
  });

  it("keeps an authored empty icon inside a wrapper whose text was deleted", () => {
    boot('<p>go <span style="color:red"><i class="icon"></i>text</span></p>');
    select(
      textOf(session!.element, "text"),
      0,
      textOf(session!.element, "text"),
      4,
    );
    chord("Backspace");
    expect(committed().innerHTML).toContain('<i class="icon"></i>');
  });

  it("drops a wrapper left empty by emptying the wrapper inside it", () => {
    boot("<p>a <b><i>xy</i></b> c</p>");
    select(
      textOf(session!.element, "xy"),
      0,
      textOf(session!.element, "xy"),
      2,
    );
    chord("Backspace");
    expect(committed().innerHTML).toBe("<p>a  c</p>");
  });

  it("drops an emptied span that looks like an authored spacer", () => {
    boot('<p><span></span>a <span class="x">bc</span> d</p>');
    select(
      textOf(session!.element, "bc"),
      0,
      textOf(session!.element, "bc"),
      2,
    );
    chord("Backspace");
    expect(committed().innerHTML).toBe("<p><span></span>a  d</p>");
  });
});

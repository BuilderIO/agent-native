// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";
import {
  caret,
  installSelectionModify,
  mount,
  press,
  restoreGlobals,
  show,
  textNodes,
  type,
} from "./rte-test-utils";

let session: InPlaceTextSession | null = null;

beforeAll(() => {
  installSelectionModify();
});

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
  restoreGlobals();
});

/** Mounts `html` in a text block and places the caret at the first `|`. */
function edit(html: string) {
  const el = mount(`<div id="t">${html.replace("|", "")}</div>`);
  session = startInPlaceTextSession(el, {});
  let remaining = html.replace(/<[^>]*>/g, "").indexOf("|");
  for (const node of textNodes(el)) {
    if (remaining <= node.length) {
      caret(node, remaining);
      return session.element;
    }
    remaining -= node.length;
  }
  throw new Error(`no caret position in ${html}`);
}

/** Same, with the caret in an element that has no text node. */
function editEmpty(html: string, selector: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  caret(el.querySelector(selector)!, 0);
  return session.element;
}

function keys(el: HTMLElement, steps: string[]) {
  for (const step of steps) {
    if (step.startsWith("type:")) type(el, step.slice(5));
    else press(el, step);
  }
}

/** The saved document: what the session writes back, placeholders gone. */
function saved(el: HTMLElement) {
  return session!.cloneWithoutPlaceholders(el).innerHTML;
}

const NBSP = "\u00a0";
const BOLD = '<span data-slide-inline-style="true" style="font-weight: 700;">';

/** The text of the block with placeholders removed. */
function text(el: HTMLElement) {
  return el.textContent!.replaceAll("\u200b", "");
}

describe("a space typed right after a collapsed style toggle", () => {
  it("keeps the space and the letter inside the pending style", () => {
    const el = edit("<p>a|</p>");
    keys(el, ["Meta+b", "type: c"]);
    expect(saved(el)).toBe(`<p>a${BOLD} c</span></p>`);
  });

  it("keeps the style when the space and letter are typed separately", () => {
    const el = edit("<p>a|</p>");
    keys(el, ["Meta+i", "type: ", "type:c"]);
    expect(saved(el)).toBe(
      '<p>a<span data-slide-inline-style="true" style="font-style: italic;"> c</span></p>',
    );
  });

  it("leaves the space after a toggle-off outside the bold run", () => {
    const el = edit("<p>a|</p>");
    keys(el, ["Meta+b", "type:c", "Meta+b", "type: d"]);
    expect(text(el)).toBe("ac d");
    const bold = textNodes(el).find(
      (node) => node.data === "c",
    )!.parentElement!;
    const space = textNodes(el).find((node) =>
      node.data.includes(" d"),
    )!.parentElement!;
    expect(bold.style.fontWeight).toBe("700");
    expect(space.style.fontWeight).toBe("400");
    expect(space.parentElement).toBe(bold.parentElement);
  });

  it("keeps a style that is added at the end of another nested in it", () => {
    const el = edit("<p>a|</p>");
    keys(el, ["Meta+b", "type:c", "Meta+i", "type:d"]);
    const italic = textNodes(el).find(
      (node) => node.data === "d",
    )!.parentElement!;
    expect(italic.parentElement!.style.fontWeight).toBe("700");
  });

  it("keeps a lone typed space", () => {
    const el = edit("<p>a|</p>");
    keys(el, ["Meta+b", "type: "]);
    expect(text(el)).toBe(`a${NBSP}`);
  });
});

describe("spaces typed into a block that started empty", () => {
  it("keeps a doubled space visible in a sentence", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["type:the quick  brown  fox"]);
    expect(text(el)).toBe(`the quick${NBSP} brown${NBSP} fox`);
  });

  it("alternates leading spaces so none collapse", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["type:    - ", "type:b"]);
    expect(text(el)).toBe(`${NBSP} ${NBSP} - b`);
  });

  it("keeps a single space after a word plain once text follows", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["type:a b"]);
    expect(text(el)).toBe("a b");
  });

  it("keeps a trailing space visible", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["type:a "]);
    expect(text(el)).toBe(`a${NBSP}`);
  });

  it("keeps the first space on an empty line", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["type: x"]);
    expect(text(el)).toBe(`${NBSP}x`);
  });
});

describe("Enter at the end of an inline element", () => {
  it("leaves no empty copy of it in the new block", () => {
    const el = edit('<p><a href="x">ab|</a> cd</p>');
    keys(el, ["Enter"]);
    const [, second] = Array.from(el.querySelectorAll("p"));
    expect(second.innerHTML).toBe(" cd");
  });
});

describe("a space typed at an inline boundary", () => {
  it("is a plain space once text follows it", () => {
    const el = edit("<blockquote><p>see https://a.com/x|</p></blockquote>");
    keys(el, ["type: ", "type:ok"]);
    expect(saved(el)).toBe(
      '<blockquote><p>see <a href="https://a.com/x">https://a.com/x</a> ok</p></blockquote>',
    );
  });

  it("turns the nbsp the caret was typed after into a plain space", () => {
    const el = edit(`<p>Owner:${NBSP}|</p>`);
    keys(el, ["type:T"]);
    expect(text(el)).toBe("Owner: T");
  });

  it("keeps a leading nbsp that starts the line", () => {
    const el = edit(`<p>${NBSP}|</p>`);
    keys(el, ["type:T"]);
    expect(text(el)).toBe(`${NBSP}T`);
  });
});

describe("autolink", () => {
  it("does not rewrite the href of an existing link", () => {
    const el = mount(
      `<div id="t"><p><a href="https://a.com">https://b.com</a></p></div>`,
    );
    session = startInPlaceTextSession(el, {});
    caret(el.querySelector("p")!, 1);
    keys(el, ["type: ", "type:x"]);
    expect(saved(el)).toBe(
      '<p><a href="https://a.com">https://b.com</a> x</p>',
    );
  });

  it("links a bare URL when Enter ends it", () => {
    const el = edit("<p>https://a.com/x|</p>");
    keys(el, ["Enter", "type:ab"]);
    const [first, second] = Array.from(el.querySelectorAll("p"));
    expect(first.innerHTML).toBe(
      '<a href="https://a.com/x">https://a.com/x</a>',
    );
    expect(second.textContent).toBe("ab");
    expect(second.querySelector("a[href]")).toBeNull();
  });

  it("undoes the link and the split together", () => {
    const el = edit("<p>https://a.com/x|</p>");
    keys(el, ["Enter", "Meta+z"]);
    expect(show(el)).toBe("<p>https://a.com/x|</p>");
  });

  it("links the URL in a list item and leaves the new item plain", () => {
    const el = edit("<ul><li>see https://a.com/x|</li></ul>");
    keys(el, ["Enter", "type:ab"]);
    const [first, second] = Array.from(el.querySelectorAll("li"));
    expect(first.innerHTML).toBe(
      'see <a href="https://a.com/x">https://a.com/x</a>',
    );
    expect(second.textContent).toBe("ab");
    expect(second.querySelector("a[href]")).toBeNull();
  });

  it("does not link a URL that continues past the caret", () => {
    const el = edit("<p>https://a.com/x|yz</p>");
    keys(el, ["Enter"]);
    expect(show(el)).toBe("<p>https://a.com/x</p><p>|yz</p>");
  });
});

describe("inline code rule", () => {
  it("leaves double backticks literal", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["type:``x``"]);
    expect(saved(el).replaceAll("\u200b", "")).toBe("<p>``x``</p>");
  });

  it("still converts a single backtick pair", () => {
    const el = edit("<p>a |</p>");
    keys(el, ["type:`x`"]);
    expect(el.querySelector("code")!.textContent).toBe("x");
  });
});

describe("a pending style typed at the end of a decorated run", () => {
  const typedIn = (el: HTMLElement, data: string) =>
    textNodes(el).find((node) => node.data === data)!.parentElement!;

  it("stays inside an underline", () => {
    const el = edit(
      '<p>a<span style="text-decoration: underline;">b|</span></p>',
    );
    keys(el, ["Meta+b", "type:c"]);
    const bold = typedIn(el, "c");
    expect(bold.closest("span[style*=underline]")).not.toBeNull();
    expect(bold.style.fontWeight).toBe("700");
  });

  it("stays inside a highlight", () => {
    const el = edit('<p>a<span style="background: yellow;">b|</span></p>');
    keys(el, ["Meta+b", "type:c"]);
    expect(typedIn(el, "c").closest("span[style*=yellow]")).not.toBeNull();
  });

  it("stays inside a <u> through a bold toggle on and off", () => {
    const el = edit("<p><u>ab|</u></p>");
    keys(el, ["Meta+b", "type:c", "Meta+b", "type:d"]);
    expect(typedIn(el, "c").closest("u")).not.toBeNull();
    expect(typedIn(el, "d").closest("u")).not.toBeNull();
  });

  it("stays inside a bold run that also carries a color", () => {
    const el = edit(
      '<p><span style="font-weight: 700; color: red;">ab|</span></p>',
    );
    keys(el, ["Meta+b", "type:c"]);
    expect(typedIn(el, "c").closest("span[style*=red]")).not.toBeNull();
  });
});

describe("Enter before an author-placed empty inline element", () => {
  it("keeps an icon element in the new block", () => {
    const el = edit('<p>ab|<i class="icon"></i>cd</p>');
    keys(el, ["Enter"]);
    expect(saved(el)).toBe('<p>ab</p><p><i class="icon"></i>cd</p>');
  });

  it("keeps a drawn dot in the new list item", () => {
    const dot =
      '<span style="display: inline-block; width: 8px; height: 8px; background: red;"></span>';
    const el = edit(`<ul><li>ab|${dot} Foo</li></ul>`);
    keys(el, ["Enter"]);
    const [, second] = Array.from(el.querySelectorAll("li"));
    expect(second.innerHTML).toContain(dot);
  });
});

describe("source whitespace around the caret", () => {
  it("makes a space typed after a pending style visible", () => {
    const el = edit("<div>\n  Hello|\n</div>");
    keys(el, ["Meta+b", "type: "]);
    expect(text(el)).toBe(`\n  Hello${NBSP}\n`);
    keys(el, ["type:x"]);
    const bold = textNodes(el).find((node) => node.data.includes("x"))!;
    expect(bold.data).toBe(" x");
    expect(bold.parentElement!.style.fontWeight).toBe("700");
  });
});

describe("Enter inside or after a URL", () => {
  it("does not link when the rest of the URL is in the next node", () => {
    const el = edit("<p>https://a.com/x|<b>yz</b></p>");
    keys(el, ["Enter"]);
    expect(el.querySelector("a")).toBeNull();
  });
});

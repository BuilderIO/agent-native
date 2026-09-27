// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderRawSlideHtml } from "@/components/deck/SlideRenderer";

import {
  mergeRenderedEdits,
  rebaseSlideEdit,
  renderArtifactGrowth,
  SOURCE_STAMP_ATTR,
  stampSlideSource,
  storedFormOf,
} from "./slide-source-map";

const NONCE = "slide-r1.s1";
const SCOPE = '[data-slide-content-scope="slide-r1"]';

/** Mounts `stored` the way the editor canvas does, autofit layer included. */
function mount(stored: string) {
  const rendered = renderRawSlideHtml(stored, {
    scopeSelector: SCOPE,
    stampNonce: NONCE,
  });
  const root = document.createElement("div");
  root.innerHTML = rendered.html;
  for (const slide of Array.from(root.querySelectorAll(".fmd-slide"))) {
    const layer = document.createElement("div");
    layer.setAttribute("data-fmd-autofit-content", "true");
    layer.className = "fmd-autofit-scale";
    for (const child of Array.from(slide.childNodes)) {
      if (!(child instanceof HTMLStyleElement)) layer.append(child);
    }
    slide.append(layer);
  }
  const save = () =>
    mergeRenderedEdits({
      stored,
      ranges: rendered.source!.ranges,
      base: rendered.html,
      live: root.cloneNode(true) as Element,
      nonce: NONCE,
    });
  return { root, save, html: rendered.html };
}

const q = (root: Element, selector: string) =>
  root.querySelector<HTMLElement>(selector)!;

describe("stampSlideSource", () => {
  it("stamps every located start tag with ranges that slice back to the element", () => {
    const stored =
      '<style>.a{color:red}</style><div class="fmd-slide"><p title="a>b">x<br>y<img src=a/></p><p>implied' +
      '<!-- note --><svg viewBox="0 0 1 1"><path d="M0"/></svg><hr/></div>';
    const { html, ranges } = stampSlideSource(stored, "n");
    expect(ranges.map((r) => r.tag)).toEqual([
      "style",
      "div",
      "p",
      "br",
      "img",
      "p",
      "svg",
      "path",
      "hr",
    ]);
    for (const range of ranges) {
      expect(stored.slice(range.openStart, range.openStart + 1)).toBe("<");
      expect(stored[range.openEnd - 1]).toBe(">");
    }
    expect(ranges[2].closeStart).not.toBeNull();
    expect(ranges[5].closeStart).toBeNull();
    // <hr> closes the open <p>.
    expect(stored.slice(ranges[5].openStart, ranges[5].closeEnd)).toBe(
      '<p>implied<!-- note --><svg viewBox="0 0 1 1"><path d="M0"/></svg>',
    );
    // `/` after an unquoted value stays part of the value.
    expect(html).toContain('<img src=a/ data-src-i="n:4">');
    expect(html).toContain('<hr data-src-i="n:8"/>');
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("a/");
    expect(doc.querySelector("p")!.getAttribute("title")).toBe("a>b");
    expect(
      Array.from(doc.querySelectorAll(`[${SOURCE_STAMP_ATTR}]`)).map((el) =>
        el.getAttribute(SOURCE_STAMP_ATTR),
      ),
    ).toEqual(ranges.map((_, i) => `n:${i}`));
  });

  it("never stamps inside a mermaid block, so the diagram source is unchanged", () => {
    const stored =
      '<div class="fmd-slide"><div class="mermaid">graph TD\nA<b>x</b> --> B</div><p>after</p></div>';
    const rendered = renderRawSlideHtml(stored, {
      scopeSelector: SCOPE,
      stampNonce: NONCE,
    });
    expect(rendered.mermaidBlocks).toEqual(["graph TD\nA<b>x</b> --> B"]);
    expect(rendered.html).toContain(`<p ${SOURCE_STAMP_ATTR}=`);
  });
});

describe("mergeRenderedEdits", () => {
  it("returns the stored string unchanged when nothing was edited", () => {
    const corpus = path.resolve(
      __dirname,
      "../../scripts/edit-fidelity/corpus",
    );
    let slides = 0;
    for (const file of readdirSync(corpus).filter((f) => f.endsWith(".json"))) {
      const fixture = JSON.parse(readFileSync(path.join(corpus, file), "utf8"));
      for (const slide of fixture.slides as Array<{ content: string }>) {
        if (!slide.content.trimStart().startsWith("<")) continue;
        const { root, save } = mount(slide.content);
        // Editor-only state on live nodes is not content.
        for (const el of Array.from(root.querySelectorAll("p, h1, h2, div"))) {
          el.setAttribute("data-builder-id", "b-1");
        }
        expect(save(), file).toEqual({ html: slide.content, changed: false });
        slides++;
      }
    }
    expect(slides).toBeGreaterThan(40);
  });

  const stored =
    '<div class="fmd-slide" style="padding: 40px 60px;background:#fff">\n' +
    "  <style>.card { color: var(--ds-accent); }</style>\n" +
    '  <h2 class="title"  style="font-family:\'Work Sans Medium\';font-size:40px">Q3 <em>review</em></h2>\n' +
    "  <!-- keep me -->\n" +
    '  <ul class="points"><li data-pptx-paragraph="1" style="color:#111">One</li><li>Two</li></ul>\n' +
    '  <div class="card" style="left:10px;top:20px"><img src="https://img.logo.dev/acme.com" alt="Acme"><p>Body</p><svg width="4"><circle r="2"/></svg></div>\n' +
    "</div>";

  it("appends typed text inside the edited element only", () => {
    const { root, save } = mount(stored);
    q(root, "h2 em").append(" ok");
    const out = save();
    expect(out.changed).toBe(true);
    expect(out.html).toBe(
      stored.replace("<em>review</em>", "<em>review ok</em>"),
    );
  });

  it("writes a span wrap and a <br> as new markup inside the element", () => {
    const { root, save } = mount(stored);
    const p = q(root, ".card p");
    p.innerHTML = 'Bo<span style="font-weight: 700">dy</span><br>more';
    expect(save().html).toBe(
      stored.replace(
        "<p>Body</p>",
        '<p>Bo<span style="font-weight: 700">dy</span><br>more</p>',
      ),
    );
  });

  it("splits a list item into a sibling that keeps the stored attributes", () => {
    const { root, save } = mount(stored);
    const li = q(root, "li");
    const clone = li.cloneNode(false) as HTMLElement;
    clone.textContent = "One and a half";
    li.after(clone);
    expect(save().html).toBe(
      stored.replace(
        '<li data-pptx-paragraph="1" style="color:#111">One</li>',
        '<li data-pptx-paragraph="1" style="color:#111">One</li><li data-pptx-paragraph="1" style="color:#111">One and a half</li>',
      ),
    );
  });

  it("applies a style change per declaration and keeps untouched bytes", () => {
    const { root, save } = mount(stored);
    const card = q(root, ".card");
    card.style.left = "30px";
    card.style.top = "45px";
    q(root, "h2").style.fontSize = "48px";
    const out = save().html;
    expect(out).toContain('<div class="card" style="left: 30px; top: 45px">');
    // The font rename the renderer made never reaches storage.
    expect(out).toContain(
      '<h2 class="title"  style="font-family:\'Work Sans Medium\'; font-size: 48px">',
    );
    expect(out.replace(/style="[^"]*"/g, "")).toBe(
      stored.replace(/style="[^"]*"/g, ""),
    );
  });

  it("removes exactly the deleted element's source slice", () => {
    const { root, save } = mount(stored);
    q(root, "ul").remove();
    expect(save().html).toBe(
      stored.replace(
        '<ul class="points"><li data-pptx-paragraph="1" style="color:#111">One</li><li>Two</li></ul>',
        "",
      ),
    );
  });

  it("keeps stored-only svg, comments and <style> when their parent is rebuilt", () => {
    const { root, save } = mount(stored);
    const card = q(root, ".card");
    card.prepend(document.createTextNode("New "));
    const out = save().html;
    expect(out).toContain('<svg width="4"><circle r="2"/></svg>');
    expect(out).toContain("<!-- keep me -->");
    expect(out).toContain("<style>.card { color: var(--ds-accent); }</style>");
    expect(out).toContain(
      'New <img src="https://img.logo.dev/acme.com" alt="Acme">',
    );
  });

  it("never stores the logo filter or the scoped stylesheet", () => {
    const { root, save } = mount(stored);
    expect(root.innerHTML).toContain("brightness(0) invert(1)");
    expect(root.innerHTML).toContain(SCOPE);
    q(root, "img").setAttribute("alt", "Acme Inc");
    const out = save().html;
    expect(out).toContain(
      '<img src="https://img.logo.dev/acme.com" alt="Acme Inc">',
    );
    expect(renderArtifactGrowth(stored, out)).toEqual([]);
  });

  it("gives a copy of an element in its stored form", () => {
    const { root, html } = mount(stored);
    const copy = q(root, ".card").cloneNode(true) as HTMLElement;
    copy.setAttribute("data-slide-object-id", "copy-1");
    copy.style.left = "26px";
    const out = storedFormOf(
      {
        stored,
        ranges: stampSlideSource(stored, NONCE).ranges,
        base: html,
        nonce: NONCE,
      },
      copy,
    );
    expect(out).toBe(
      '<div class="card" style="top:20px; left: 26px" data-slide-object-id="copy-1"><img src="https://img.logo.dev/acme.com" alt="Acme"><p>Body</p><svg width="4"><circle r="2"/></svg></div>',
    );
  });

  it("treats an element stamped by another canvas as new content", () => {
    const { root, save } = mount(stored);
    const foreign = document.createElement("p");
    foreign.setAttribute(SOURCE_STAMP_ATTR, "other.s9:2");
    foreign.textContent = "Pasted";
    q(root, ".card").append(foreign);
    const out = save().html;
    expect(out).toContain("<p>Pasted</p>");
    expect(out).not.toContain(SOURCE_STAMP_ATTR);
  });

  it("falls back to canonical markup for a misnested element only", () => {
    const misnested =
      '<div class="fmd-slide"><p class="a">keep  me</p><b><p>x</b>y</p></div>';
    const { ranges } = stampSlideSource(misnested, NONCE);
    // The tree a spec parser builds (happy-dom does not run the adoption
    // agency algorithm): the <b> is cloned into the <p>.
    const s = (i: number) => `${SOURCE_STAMP_ATTR}="${NONCE}:${i}"`;
    const base = `<div class="fmd-slide" ${s(0)}><p class="a" ${s(1)}>keep  me</p><b ${s(2)}></b><p ${s(3)}><b ${s(2)}>x</b>y</p></div>`;
    const live = document.createElement("div");
    live.innerHTML = base;
    live.querySelectorAll("p")[1].append("!");
    const out = mergeRenderedEdits({
      stored: misnested,
      ranges,
      base,
      live,
      nonce: NONCE,
    }).html;
    expect(out).toBe(
      '<div class="fmd-slide"><p class="a">keep  me</p><b></b><p><b>x</b>y!</p></div>',
    );
  });

  it("restores a mermaid block byte for byte when a sibling changes", () => {
    const withDiagram =
      '<div class="mermaid">graph TD\nA --> B</div><div class="fmd-slide"><p>Title</p></div>';
    const { root, save } = mount(withDiagram);
    // The diagram component replaces the placeholder with its own markup.
    const placeholder = q(root, "[data-mermaid-index]");
    placeholder.setAttribute("data-mermaid-state", "ready");
    placeholder.innerHTML = "<svg><g></g></svg>";
    q(root, ".fmd-slide p").append(" ok");
    expect(save().html).toBe(withDiagram.replace("Title", "Title ok"));
  });

  it("keeps a diagram inside the slide root once, around an edit on either side", () => {
    const inside =
      '<div class="fmd-slide" style="padding:48px"><h2>Diagram title</h2><div class="mermaid">graph TD\nA-->B</div><p>Caption below</p></div>';
    for (const target of ["p", "h2"]) {
      const { root, save } = mount(inside);
      // MermaidRenderer mounts its own node inside the placeholder.
      q(root, "[data-mermaid-index]").innerHTML =
        '<div data-mermaid-index="0" data-mermaid-state="ready"><svg></svg></div>';
      q(root, `.fmd-slide ${target}`).append(" ok");
      const edited = target === "p" ? "Caption below" : "Diagram title";
      expect(save().html, target).toBe(inside.replace(edited, `${edited} ok`));
    }
  });

  describe("an unclosed formatting tag the parser reopens in later paragraphs", () => {
    const unclosed =
      '<div class="fmd-slide" style="padding:48px"><p><strong>Heading text</p><p>Second para</p><p>Third para</p></div>';

    it("gives each start tag one stamp", () => {
      const { html } = stampSlideSource(unclosed, "n");
      expect(html).not.toMatch(/data-src-i="[^"]*"\s+data-src-i=/);
    });

    it("edits a reopened copy without writing the copy", () => {
      const { root, save } = mount(unclosed);
      expect(root.querySelectorAll("strong")).toHaveLength(3);
      q(root, "p:nth-of-type(3) strong").append(" ok");
      const out = save().html;
      expect(out).toBe(unclosed.replace("Third para", "Third para ok"));
      // A second save of the result grows nothing.
      const again = mount(out);
      q(again.root, "p:nth-of-type(3) strong").append("!");
      expect(again.save().html).toBe(
        unclosed.replace("Third para", "Third para ok!"),
      );
    });

    it("keeps the stored element's end implied, so later paragraphs stay bold", () => {
      const { root, save } = mount(unclosed);
      q(root, "p:nth-of-type(1) strong").append(" ok");
      expect(save().html).toBe(
        unclosed.replace("Heading text", "Heading text ok"),
      );
    });
  });

  it("writes a second live copy of a stored element without its stored-only nodes", () => {
    const withMarker =
      '<div class="fmd-slide"><ul><li><svg width="8"><circle r="4"/></svg><!-- n -->Item</li></ul></div>';
    const { root, save } = mount(withMarker);
    const li = q(root, "li");
    li.before(li.cloneNode(false));
    const out = save().html;
    expect(out.match(/<svg/g)).toHaveLength(1);
    expect(out.match(/<!-- n -->/g)).toHaveLength(1);
    expect(out.match(/Item/g)).toHaveLength(1);
  });

  it("reads <noscript> content as markup, as the sanitizer does", () => {
    const withNoscript =
      '<noscript><p>x</p></noscript><div class="fmd-slide"><p>y</p></div>';
    const { root, save } = mount(withNoscript);
    q(root, ".fmd-slide p").append(" ok");
    expect(save().html).toBe(withNoscript.replace("y</p>", "y ok</p>"));
  });

  it("keeps comments outside the document body when the root is rebuilt", () => {
    const commented =
      '<!-- Slide 3: Title --><div class="fmd-slide"><p>a</p></div>';
    const { root, save } = mount(commented);
    const added = document.createElement("p");
    added.textContent = "New";
    root.append(added);
    expect(save().html).toBe(`${commented}<p>New</p>`);
  });

  it("never writes the <tbody> the parser adds to a stored table", () => {
    const stored =
      '<div class="fmd-slide"><table style="width:100%"><tr><td>A</td><td>B</td></tr></table><p>after</p></div>';
    const edited = mount(stored);
    q(edited.root, "td").textContent = "A ok";
    expect(edited.save()).toEqual({
      html: stored.replace(">A<", ">A ok<"),
      changed: true,
    });
    expect(mount(stored).save()).toEqual({ html: stored, changed: false });
  });

  it("keeps the <tbody> of a table added during the edit", () => {
    const stored = '<div class="fmd-slide"><p>x</p></div>';
    const edited = mount(stored);
    q(edited.root, "p").insertAdjacentHTML(
      "afterend",
      "<table><tbody><tr><td>new</td></tr></tbody></table>",
    );
    expect(edited.save().html).toBe(
      '<div class="fmd-slide"><p>x</p><table><tbody><tr><td>new</td></tr></tbody></table></div>',
    );
  });

  it("applies a change to a shorthand that holds var()", () => {
    const withVar =
      '<div class="fmd-slide"><div class="card" style="border-left: 3px solid var(--accent); padding: 8px">x</div></div>';
    const removed = mount(withVar);
    q(removed.root, ".card").style.removeProperty("border-left");
    expect(removed.save().html).toBe(
      withVar.replace("border-left: 3px solid var(--accent); ", ""),
    );
    const changed = mount(withVar);
    q(changed.root, ".card").style.setProperty(
      "border-left",
      "3px solid var(--ds-accent)",
    );
    expect(changed.save().html).toContain("var(--ds-accent)");
    expect(changed.save().html).not.toContain("var(--accent)");
  });
});

describe("renderArtifactGrowth", () => {
  it("reports markers a write adds and allows ones already stored", () => {
    const prev = '<div class="fmd-slide"><p data-builder-id="b-1">x</p></div>';
    expect(
      renderArtifactGrowth(
        prev,
        '<div class="fmd-slide" data-slide-content-scope="s"><p data-builder-id="b-1">x</p></div>',
      ),
    ).toEqual(["data-slide-content-scope"]);
    expect(
      renderArtifactGrowth(
        prev,
        `${prev}<style>[data-slide-content-scope="s"] p { color: red; }</style>`,
      ),
    ).toEqual(["scoped-style-selector"]);
    expect(renderArtifactGrowth(prev, prev.replace("x", "y"))).toEqual([]);
  });

  it("reads markers from parsed attributes, whatever comes before them", () => {
    expect(
      renderArtifactGrowth(
        "<p>a</p>",
        '<p title="Plan > 3" data-builder-id="x">a</p>',
      ),
    ).toEqual(["data-builder-id"]);
    expect(
      renderArtifactGrowth("<p>a</p>", "<p contenteditable>a</p>"),
    ).toEqual(["contenteditable"]);
    // Older editors stored contenteditable="false"; only an editable value is
    // the live editing surface.
    expect(
      renderArtifactGrowth("<p>a</p>", '<p contenteditable="false">a</p>'),
    ).toEqual([]);
    expect(
      renderArtifactGrowth(
        "<p>a</p>",
        '<div class="card ProseMirror"><p>a</p></div>',
      ),
    ).toEqual(["ProseMirror"]);
  });

  it("allows a copy of stored styling and text that names a marker", () => {
    const logo =
      '<img style="width:120px;filter: brightness(0) invert(1);" src="a">';
    expect(renderArtifactGrowth(logo, logo + logo)).toEqual([]);
    const spacer =
      '<div class="card"><p style="visibility: hidden">x</p></div>';
    expect(renderArtifactGrowth(spacer, spacer + spacer)).toEqual([]);
    for (const text of [
      ' set contenteditable="true" on it',
      "the data-slide-content-scope attribute",
      'class="ProseMirror" data-builder-id=1',
    ]) {
      expect(renderArtifactGrowth("<p>a</p>", `<p>a${text}</p>`), text).toEqual(
        [],
      );
    }
  });
});

describe("rebaseSlideEdit", () => {
  const stored =
    '<div class="fmd-slide"><h2>Title</h2><p>Caption</p><p>Footer</p></div>';
  const { ranges } = stampSlideSource(stored, NONCE);
  const edited = stored.replace("Caption", "Caption typed");

  it("keeps an edit and a newer change to another element", () => {
    const next = stored.replace("Title", "Agent title");
    expect(rebaseSlideEdit(stored, ranges, edited, next)).toBe(
      next.replace("Caption", "Caption typed"),
    );
  });

  it("finds the edited element after the newer version moved it", () => {
    const next = stored.replace("<h2>Title</h2>", "<h1>Big</h1><h2>Title</h2>");
    expect(rebaseSlideEdit(stored, ranges, edited, next)).toBe(
      next.replace("Caption", "Caption typed"),
    );
  });

  it("widens to an element the newer version holds only once", () => {
    const twins =
      '<div class="fmd-slide"><div><p>Same</p></div><section><p>Same</p></section></div>';
    const twinRanges = stampSlideSource(twins, NONCE).ranges;
    const typed = twins.replace("<section><p>Same", "<section><p>Same!");
    const next = twins.replace("<div><p>", '<div class="a"><p>');
    expect(rebaseSlideEdit(twins, twinRanges, typed, next)).toBe(
      next.replace("<section><p>Same", "<section><p>Same!"),
    );
  });

  it("refuses when the newer version changed the edited element too", () => {
    const next = stored.replace("Caption", "Agent caption");
    expect(rebaseSlideEdit(stored, ranges, edited, next)).toBeNull();
  });

  it("returns the newer version for no edit, and the edit for no newer change", () => {
    const next = stored.replace("Title", "Agent title");
    expect(rebaseSlideEdit(stored, ranges, stored, next)).toBe(next);
    expect(rebaseSlideEdit(stored, ranges, edited, stored)).toBe(edited);
  });
});

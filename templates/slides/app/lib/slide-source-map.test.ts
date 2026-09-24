// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderRawSlideHtml } from "@/components/deck/SlideRenderer";

import {
  mergeRenderedEdits,
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
    expect(renderArtifactGrowth(prev, prev.replace("x", "y"))).toEqual([]);
    const withFilter = '<img style="filter:brightness(0) invert(1);" src="a">';
    expect(renderArtifactGrowth("", withFilter)).toEqual(["logo-filter"]);
    expect(renderArtifactGrowth("", withFilter, "server")).toEqual([]);
    expect(
      renderArtifactGrowth(
        "",
        '<div class="fmd-layout-spacer" data-slide-layout-preserved="true" style="visibility: hidden"></div>',
      ),
    ).toEqual([]);
  });
});

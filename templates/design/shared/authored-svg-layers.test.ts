import { describe, expect, it } from "vitest";

import { promoteAuthoredSvgArtworkInHtml } from "./authored-svg-layers";
import { buildCodeLayerProjection } from "./code-layer";
import { annotateAgentScreenHtmlForPersist } from "./screen-annotation";

const kit = `<svg class="il-kit" width="0" height="0" style="position:absolute"><defs><linearGradient id="il-sheen"><stop offset="0" stop-color="#fff"/></linearGradient><symbol id="il-node" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="#0A0A0A" stroke="currentColor" stroke-width="2"/></symbol><symbol id="il-chip-on" viewBox="0 0 44 44"><rect x="1" y="1" width="42" height="42" rx="8" fill="currentColor"/></symbol><symbol id="i-pencil" viewBox="0 0 24 24"><path d="M4 20h4l10.5 -10.5" fill="none" stroke="#fff"/></symbol><symbol id="il-badge" viewBox="0 0 20 20"><clipPath id="il-badge-cut"><circle cx="10" cy="10" r="10"/></clipPath><rect width="20" height="20" fill="url(#il-sheen)" clip-path="url(#il-badge-cut)"/></symbol></defs></svg>`;

const artwork = `<svg class="il" viewBox="0 0 416 312" width="416" height="312"><path d="M24 92H392" stroke="#2E2E2E" stroke-width="2"/><path class="gn" d="M28 92H110C140 92 140 160 170 160" fill="none" stroke="currentColor" stroke-width="2"/><use href="#il-node" class="gn" x="22" y="86" width="12" height="12"/><use href="#il-chip-on" class="gn" x="50" y="70" width="44" height="44"/><use href="#i-pencil" x="62" y="82" width="20" height="20"/><text x="50" y="60" fill="#9A9997">GMT</text></svg>`;

function screen(body: string): string {
  return `<!doctype html><html><head><style>.gn{color:#0FDFBA}</style></head><body>${body}</body></html>`;
}

function tagsInsideArtwork(html: string): string[] {
  const nodes = buildCodeLayerProjection(html).nodes;
  const root = nodes.find((node) => node.classes.includes("il"));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const tags: string[] = [];
  const walk = (id: string) => {
    const node = byId.get(id);
    if (!node) return;
    tags.push(node.tag);
    node.children.forEach(walk);
  };
  root?.children.forEach(walk);
  return tags;
}

describe("promoteAuthoredSvgArtworkInHtml", () => {
  it("turns agent-authored artwork into one layer per shape", () => {
    const html = screen(`${kit}${artwork}`);
    expect(tagsInsideArtwork(html)).toEqual([]);

    const { content, promoted } = promoteAuthoredSvgArtworkInHtml(html);

    expect(promoted).toBe(1);
    expect(tagsInsideArtwork(content)).toEqual([
      "path",
      "path",
      "g",
      "circle",
      "g",
      "rect",
      "g",
      "path",
      "text",
    ]);
  });

  it("places expanded symbols where the use element drew them", () => {
    const { content } = promoteAuthoredSvgArtworkInHtml(
      screen(`${kit}${artwork}`),
    );

    expect(content).toContain(
      `<g class="gn" data-agent-native-layer-name="il-chip-on" transform="translate(50 70)" clip-path="url(#il-chip-on-viewport-4)"><clipPath id="il-chip-on-viewport-4"><rect x="0" y="0" width="44" height="44"></rect></clipPath><rect x="1" y="1" width="42" height="42" rx="8" fill="currentColor"></rect></g>`,
    );
    expect(content).toContain(
      `<g data-agent-native-layer-name="i-pencil" transform="translate(62 82) scale(0.833)" clip-path="url(#i-pencil-viewport-6)">`,
    );
    expect(content).not.toMatch(/<use\b/);
  });

  it("leaves icons, hidden kits, and editor-owned SVGs as single layers", () => {
    const icon = `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 20h4"/></svg>`;
    const owned = `<svg data-an-primitive="path" width="200" height="200"><path d="M0 0h10"/></svg>`;
    const html = screen(`${kit}${icon}${owned}`);

    expect(promoteAuthoredSvgArtworkInHtml(html)).toEqual({
      content: html,
      promoted: 0,
    });
  });

  it("leaves locked artwork alone", () => {
    const html = screen(
      `<div data-agent-native-locked="true">${kit}${artwork}</div>`,
    );

    expect(promoteAuthoredSvgArtworkInHtml(html).content).toBe(html);
  });

  it("gives every expansion its own copy of the ids the symbol owns", () => {
    const html = screen(
      `${kit}<svg viewBox="0 0 100 100" width="100" height="100"><use href="#il-badge" width="20" height="20"/><use href="#il-badge" x="40" width="20" height="20"/></svg>`,
    );

    const { content } = promoteAuthoredSvgArtworkInHtml(html);
    const clipIds = [
      ...content.matchAll(/<clipPath id="(il-badge-cut[^"]*)"/g),
    ].map((match) => match[1]);

    expect(clipIds).toHaveLength(3);
    expect(new Set(clipIds).size).toBe(3);
    for (const id of clipIds.slice(1)) {
      expect(content).toContain(`clip-path="url(#${id})"`);
    }
    expect(content).toContain(`fill="url(#il-sheen)"`);
  });

  it("keeps a use whose target is missing or recursive", () => {
    const html = screen(
      `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="loop" viewBox="0 0 10 10"><use href="#loop"/></symbol></defs><use href="#missing"/><use href="#loop" width="10" height="10"/></svg>`,
    );

    const { content } = promoteAuthoredSvgArtworkInHtml(html);

    expect(content).toContain(`<use href="#missing"/>`);
    expect(content).toContain(
      `<g data-agent-native-layer-name="loop" clip-path="url(#loop-viewport-2)"><clipPath id="loop-viewport-2"><rect x="0" y="0" width="10" height="10"></rect></clipPath><use href="#loop"></use></g>`,
    );
  });

  it("keeps the paint a symbol gives its shapes", () => {
    const { content } = promoteAuthoredSvgArtworkInHtml(
      screen(
        `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10" fill="#f00" stroke="#000"><circle cx="5" cy="5" r="4"/></symbol></defs><use href="#dot" width="10" height="10"/></svg>`,
      ),
    );

    expect(content).toContain(
      `<g fill="#f00" stroke="#000"><clipPath id="dot-viewport-2"><rect x="0" y="0" width="10" height="10"></rect></clipPath><circle cx="5" cy="5" r="4"></circle></g>`,
    );
  });

  it("sizes a bare symbol use to the viewport it is drawn in", () => {
    const { content } = promoteAuthoredSvgArtworkInHtml(
      screen(
        `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs><use href="#dot"/></svg>`,
      ),
    );

    expect(content).toContain(
      `<g data-agent-native-layer-name="dot" transform="scale(10)" clip-path="url(#dot-viewport-2)">`,
    );
  });

  it("resolves percentage use lengths and keeps ones it can't resolve", () => {
    const { content } = promoteAuthoredSvgArtworkInHtml(
      screen(
        `<svg viewBox="0 0 200 100" width="200" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs><use href="#dot" x="50%" y="10%" width="10" height="10"/><use href="#dot" x="2em" width="10" height="10"/></svg>`,
      ),
    );

    expect(content).toContain(
      `<g data-agent-native-layer-name="dot" transform="translate(100 10)" clip-path="url(#dot-viewport-2)">`,
    );
    expect(content).toContain(
      `<use href="#dot" x="2em" width="10" height="10"/>`,
    );
  });

  it("keeps a use whose shapes a stylesheet selects by id", () => {
    const html = `<!doctype html><html><head><style>#dot-core{fill:red}</style></head><body><svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle id="dot-core" cx="5" cy="5" r="4"/></symbol></defs><use href="#dot" width="10" height="10"/></svg></body></html>`;

    const { content, promoted } = promoteAuthoredSvgArtworkInHtml(html);

    expect(promoted).toBe(1);
    expect(content).toContain(`<use href="#dot" width="10" height="10"/>`);
  });

  it("stops expanding when nested uses would copy too many shapes", () => {
    const level = (name: string, child: string) =>
      `<symbol id="${name}" viewBox="0 0 10 10">${Array.from({ length: 10 }, () => `<use href="#${child}" width="10" height="10"/>`).join("")}</symbol>`;
    const html = screen(
      `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="l0" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol>${level("l1", "l0")}${level("l2", "l1")}${level("l3", "l2")}${level("l4", "l3")}</defs><use href="#l4" width="10" height="10"/></svg>`,
    );

    const { content } = promoteAuthoredSvgArtworkInHtml(html);

    expect(content).toContain(`<use href="#l4" width="10" height="10"/>`);
    expect(content.length).toBeLessThan(html.length * 2);
  });

  it("clips an expanded symbol to its viewport unless overflow is visible", () => {
    const { content } = promoteAuthoredSvgArtworkInHtml(
      screen(
        `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="wide" viewBox="0 0 10 20"><rect width="10" height="20"/></symbol><symbol id="open" viewBox="0 0 10 10" overflow="visible"><rect width="10" height="10"/></symbol></defs><use href="#wide" width="40" height="20"/><use href="#open" width="10" height="10"/></svg>`,
      ),
    );

    expect(content).toContain(
      `<g data-agent-native-layer-name="wide" transform="translate(15 0)" clip-path="url(#wide-viewport-2)"><clipPath id="wide-viewport-2"><rect x="-15" y="0" width="40" height="20"></rect></clipPath>`,
    );
    expect(content).toContain(
      `<g data-agent-native-layer-name="open"><g overflow="visible"><rect width="10" height="10"></rect></g></g>`,
    );
  });

  it("keeps a use that a stylesheet sizes, transforms, or selects by tag", () => {
    const symbol = `<defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs>`;
    const art = (uses: string) =>
      `<svg viewBox="0 0 100 100" width="100" height="100">${symbol}${uses}</svg>`;
    const withStyle = (css: string, uses: string) =>
      `<!doctype html><html><head><style>${css}</style></head><body>${art(uses)}</body></html>`;
    const sized = withStyle(
      `.big{width:40px}.tint{fill:red}`,
      `<use class="big" href="#dot"/><use class="tint" href="#dot"/>`,
    );
    const byTag = withStyle(`svg > use{opacity:.5}`, `<use href="#dot"/>`);
    const inline = withStyle(
      ``,
      `<use href="#dot" style="transform: rotate(10deg)"/>`,
    );

    const sizedResult = promoteAuthoredSvgArtworkInHtml(sized).content;
    expect(sizedResult).toContain(`<use class="big" href="#dot"/>`);
    expect(sizedResult).not.toContain(`<use class="tint"`);
    expect(promoteAuthoredSvgArtworkInHtml(byTag).content).toContain(
      `<use href="#dot"/>`,
    );
    expect(promoteAuthoredSvgArtworkInHtml(inline).content).toContain(
      `<use href="#dot" style="transform: rotate(10deg)"/>`,
    );
  });

  it("expands only the outermost of nested use elements", () => {
    const html = screen(
      `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs><use href="#dot" width="10" height="10"><g><use href="#dot" width="10" height="10"/></g></use></svg>`,
    );

    const { content, promoted } = promoteAuthoredSvgArtworkInHtml(html);

    expect(promoted).toBe(1);
    expect(content).not.toMatch(/<use\b/);
  });

  it("keeps a locked use and a use that points at an HTML element", () => {
    const html = screen(
      `<div id="card">Card</div><svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs><g data-agent-native-locked="true"><use href="#dot" width="10" height="10"/></g><use href="#card"/></svg>`,
    );

    const { content, promoted } = promoteAuthoredSvgArtworkInHtml(html);

    expect(promoted).toBe(1);
    expect(content).toContain(
      `<g data-agent-native-locked="true"><use href="#dot" width="10" height="10"/></g>`,
    );
    expect(content).toContain(`<use href="#card"/>`);
  });

  it("gives the group the use's layer id, but not copies nested in a symbol", () => {
    const html = screen(
      `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol><symbol id="pair" viewBox="0 0 20 10"><use data-agent-native-node-id="inner" href="#dot" width="10" height="10"/></symbol></defs><use data-agent-native-node-id="outer" href="#pair" width="20" height="10"/></svg>`,
    );

    const { content } = promoteAuthoredSvgArtworkInHtml(html);

    expect(content).toContain(
      `<g data-agent-native-node-id="outer" data-agent-native-layer-name="pair"`,
    );
    expect(content.match(/data-agent-native-node-id="inner"/g)).toHaveLength(1);
  });

  it("promotes only the artwork an edit wrote", () => {
    const untouched = `<svg class="kept" viewBox="0 0 100 100" width="100" height="100"><path d="M0 0h10"/></svg>`;
    const written = `<svg class="new" viewBox="0 0 100 100" width="100" height="100"><path d="M0 0h20"/></svg>`;
    const before = screen(untouched);

    const { content, promoted } = promoteAuthoredSvgArtworkInHtml(
      screen(`${untouched}${written}`),
      { previousHtml: before },
    );

    expect(promoted).toBe(1);
    expect(content).toContain(untouched);
    expect(content).toContain(
      `<svg class="new" viewBox="0 0 100 100" width="100" height="100" data-an-primitive="pasted-svg">`,
    );
  });

  it("keeps a use that utility classes or a linked stylesheet may size", () => {
    const art = (uses: string) =>
      `<svg viewBox="0 0 100 100" width="100" height="100"><defs><symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol></defs>${uses}</svg>`;
    const page = (head: string, uses: string) =>
      `<!doctype html><html><head>${head}</head><body>${art(uses)}</body></html>`;
    const fonts = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`;

    const tailwind = promoteAuthoredSvgArtworkInHtml(
      page(
        fonts,
        `<use class="md:w-6" href="#dot"/><use class="text-emerald-400" href="#dot"/>`,
      ),
    ).content;
    const linked = promoteAuthoredSvgArtworkInHtml(
      page(
        `<link rel="stylesheet" href="/site.css">`,
        `<use class="icon" href="#dot"/>`,
      ),
    ).content;

    expect(tailwind).toContain(`<use class="md:w-6" href="#dot"/>`);
    expect(tailwind).not.toContain(`<use class="text-emerald-400"`);
    expect(linked).toContain(`<use class="icon" href="#dot"/>`);
  });

  it("is stable when a promoted screen is saved again", () => {
    const once = annotateAgentScreenHtmlForPersist(
      screen(`${kit}${artwork}`),
      "html",
    );

    expect(annotateAgentScreenHtmlForPersist(once, "html")).toBe(once);
  });
});

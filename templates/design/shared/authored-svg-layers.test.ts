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
      `<g class="gn" data-agent-native-layer-name="il-chip-on" transform="translate(50 70)"><rect x="1" y="1" width="42" height="42" rx="8" fill="currentColor"></rect></g>`,
    );
    expect(content).toContain(
      `<g data-agent-native-layer-name="i-pencil" transform="translate(62 82) scale(0.833)">`,
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
    const clipIds = [...content.matchAll(/<clipPath id="([^"]+)"/g)].map(
      (match) => match[1],
    );

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
      `<g data-agent-native-layer-name="loop"><use href="#loop"></use></g>`,
    );
  });

  it("is stable when a promoted screen is saved again", () => {
    const once = annotateAgentScreenHtmlForPersist(
      screen(`${kit}${artwork}`),
      "html",
    );

    expect(annotateAgentScreenHtmlForPersist(once, "html")).toBe(once);
  });
});

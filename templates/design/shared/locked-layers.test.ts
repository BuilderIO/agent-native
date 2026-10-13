import { describe, expect, it } from "vitest";

import {
  assertLockedLayersPreserved,
  countLockedLayers,
  countLockedLayersAcrossFiles,
} from "./locked-layers.js";

const source = `<!doctype html><html><body>
  <div data-agent-native-node-id="bg" data-agent-native-locked="true"><span>Fixed</span></div>
  <main data-agent-native-node-id="content">Editable</main>
</body></html>`;

describe("locked layers", () => {
  it("allows edits outside a locked subtree", () => {
    const next = source.replace(">Editable<", ">Changed<");
    expect(() => assertLockedLayersPreserved(source, next)).not.toThrow();
    expect(countLockedLayers(source)).toBe(1);
  });

  it("rejects changing or deleting a locked subtree", () => {
    expect(() =>
      assertLockedLayersPreserved(source, source.replace("Fixed", "Changed")),
    ).toThrow(/locked layer/i);
    expect(() =>
      assertLockedLayersPreserved(
        source,
        source.replace(
          '<div data-agent-native-node-id="bg" data-agent-native-locked="true"><span>Fixed</span></div>',
          "",
        ),
      ),
    ).toThrow(/locked layer/i);
  });

  it("rejects moving, reparenting, or reordering an unchanged locked subtree", () => {
    const locked =
      '<div data-agent-native-node-id="bg" data-agent-native-locked="true"><span>Fixed</span></div>';

    const reordered = source
      .replace(`  ${locked}\n`, "")
      .replace(
        '  <main data-agent-native-node-id="content">Editable</main>',
        `  <main data-agent-native-node-id="content">Editable</main>\n  ${locked}`,
      );
    expect(() => assertLockedLayersPreserved(source, reordered)).toThrow(
      /locked layer/i,
    );

    const reparented = source
      .replace(`  ${locked}\n`, "")
      .replace(
        '  <main data-agent-native-node-id="content">Editable</main>',
        `  <main data-agent-native-node-id="content">Editable\n    ${locked}\n  </main>`,
      );
    expect(() => assertLockedLayersPreserved(source, reparented)).toThrow(
      /locked layer/i,
    );

    const nested = `<!doctype html><html><body>
  <section data-agent-native-node-id="left"><div data-agent-native-node-id="locked-parent">${locked}</div></section>
  <section data-agent-native-node-id="right"></section>
</body></html>`;
    const movedAncestor = nested
      .replace(
        '<section data-agent-native-node-id="left"><div data-agent-native-node-id="locked-parent">',
        '<section data-agent-native-node-id="left"></section><section data-agent-native-node-id="right"><div data-agent-native-node-id="locked-parent">',
      )
      .replace(
        `</div></section>\n  <section data-agent-native-node-id="right"></section>`,
        "</div></section>",
      );
    expect(() => assertLockedLayersPreserved(nested, movedAncestor)).toThrow(
      /locked layer/i,
    );
  });

  it("allows inserting and removing unlocked siblings around a locked layer", () => {
    const artboard = `<!doctype html><html><body>
  <main data-agent-native-node-id="artboard">
    <div data-agent-native-node-id="bg" data-agent-native-layer-name="Background" data-agent-native-locked="true"></div>
    <div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">Northstar</div>
    <section data-agent-native-node-id="content"><h1>Old</h1></section>
  </main>
</body></html>`;

    for (const next of [
      artboard.replace(
        '<div data-agent-native-node-id="bg"',
        '<div class="glow"></div>\n    <div data-agent-native-node-id="bg"',
      ),
      artboard.replace(
        '<section data-agent-native-node-id="content">',
        '<div class="rule"></div>\n    <section data-agent-native-node-id="content">',
      ),
      artboard.replace(
        '    <section data-agent-native-node-id="content"><h1>Old</h1></section>\n',
        "",
      ),
    ]) {
      expect(() => assertLockedLayersPreserved(artboard, next)).not.toThrow();
    }
  });

  it("rejects an edit that re-locks a layer the editor unlocked", () => {
    const unlocked = source.replace(' data-agent-native-locked="true"', "");
    expect(() => assertLockedLayersPreserved(unlocked, source)).toThrow(
      /locks layer/i,
    );
    expect(() =>
      assertLockedLayersPreserved(
        unlocked,
        unlocked.replace(
          '<main data-agent-native-node-id="content">',
          '<main data-agent-native-node-id="content" data-agent-native-locked="true">',
        ),
      ),
    ).toThrow(/locks layer/i);
  });

  it("ignores unrelated head edits that shift unstamped ancestor offsets", () => {
    const page = (title: string) =>
      `<!doctype html><html><head><title>${title}</title></head><body>
  <main data-agent-native-node-id="art">
    <div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">N</div>
    <h1 data-agent-native-node-id="h">Old</h1>
  </main>
</body></html>`;
    expect(() =>
      assertLockedLayersPreserved(page("T"), page("A far longer page title")),
    ).not.toThrow();
  });

  it("rejects moving a locked layer across an unstamped sibling", () => {
    const shell = (inner: string) => `<!doctype html><html><body>
  <main data-agent-native-node-id="art">${inner}
  </main>
</body></html>`;
    const locked =
      '<div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">N</div>';
    expect(() =>
      assertLockedLayersPreserved(
        shell(`\n    ${locked}\n    <span>plain</span>`),
        shell(`\n    <span>plain</span>\n    ${locked}`),
      ),
    ).toThrow(/locked layer/i);
  });

  it("allows an unstamped locked layer when earlier content changes length", () => {
    const page = (lead: string) =>
      `<!doctype html><html><body><main data-agent-native-node-id="art">
  <p>${lead}</p>
  <div class="bg" data-agent-native-layer-name="BG" data-agent-native-locked="true"></div>
</main></body></html>`;
    expect(() =>
      assertLockedLayersPreserved(page("hi"), page("a much longer lead line")),
    ).not.toThrow();
  });

  it("refuses to pass a move it cannot verify past indistinguishable siblings", () => {
    const shell = (inner: string) =>
      `<!doctype html><html><body><main data-agent-native-node-id="art">${inner}
</main></body></html>`;
    const locked =
      '<div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">L</div>';
    expect(() =>
      assertLockedLayersPreserved(
        shell(`\n  <span>x</span>\n  <span>x</span>\n  ${locked}`),
        shell(`\n  ${locked}\n  <span>x</span>\n  <span>x</span>`),
      ),
    ).toThrow(/cannot verify/i);
  });

  it("refuses a duplicated stable id instead of treating the clone as the original", () => {
    const node =
      '<div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">A</div>';
    const shell = (inner: string) =>
      `<!doctype html><html><body><main data-agent-native-node-id="art">${inner}
</main></body></html>`;
    expect(() =>
      assertLockedLayersPreserved(
        shell(`\n  ${node}`),
        shell(`\n  ${node}\n  ${node}`),
      ),
    ).toThrow(/cannot verify/i);
  });

  it("refuses reparenting between containers it cannot tell apart", () => {
    const locked =
      '<div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">L</div>';
    const shell = (inner: string) =>
      `<!doctype html><html><body><main data-agent-native-node-id="art">${inner}
</main></body></html>`;
    expect(() =>
      assertLockedLayersPreserved(
        shell(
          `\n  <div class="box">${locked}</div>\n  <div class="box"></div>`,
        ),
        shell(
          `\n  <div class="box"></div>\n  <div class="box">${locked}</div>`,
        ),
      ),
    ).toThrow(/cannot verify/i);
  });

  it("allows inserting a sibling that duplicates another sibling's signature", () => {
    const shell = (inner: string) => `<!doctype html><html><body>
  <main data-agent-native-node-id="art">${inner}
  </main>
</body></html>`;
    const locked =
      '<div data-agent-native-node-id="logo" data-agent-native-layer-name="Logo" data-agent-native-locked="true">N</div>';
    expect(() =>
      assertLockedLayersPreserved(
        shell(`\n    <span>one</span>\n    ${locked}`),
        shell(`\n    <span>one</span>\n    <span>two</span>\n    ${locked}`),
      ),
    ).not.toThrow();
  });

  it("counts only durable DOM locks across files", () => {
    expect(
      countLockedLayersAcrossFiles([
        { content: source },
        {
          content:
            '<section data-agent-native-node-id="second" data-agent-native-locked="true">Fixed</section>',
        },
        { content: "screen-id-only" },
      ]),
    ).toBe(2);
  });
});

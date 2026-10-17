import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  enableInlineScreenAutoLayout,
  getRuntimeScreenAutoLayoutSubjectIds,
  resolveInlineScreenAutoLayoutRoot,
} from "./screen-auto-layout";

describe("screen auto layout", () => {
  it("enables auto layout on an authored body without disturbing Alpine directives", () => {
    const content = `<!doctype html>
      <html>
        <body x-data="{ open: true }" style="width:320px;height:200px">
          <section x-show="open" style="position:absolute;left:12px;top:16px;width:80px;height:40px">Alpha</section>
          <section style="position:absolute;left:112px;top:16px;width:80px;height:40px">Beta</section>
        </body>
      </html>`;

    const result = enableInlineScreenAutoLayout({
      content,
      width: 320,
      height: 200,
    });

    expect(result.status).toBe("applied");
    expect(result.content).toContain('x-data="{ open: true }"');
    expect(result.content).toContain('x-show="open"');
    const projection = buildCodeLayerProjection(result.content);
    const body = projection.nodes.find((node) => node.tag === "body");
    expect(body?.style.display).toBe("flex");
    expect(body?.style["flex-direction"]).toBe("row");
    expect(body?.style["align-items"]).toBe("flex-start");
    expect(body?.style.gap).toBe("20px");
    expect(body?.style.padding).toBe("12px");
    const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
    for (const childId of body?.children ?? []) {
      const child = nodes.get(childId);
      expect(child?.style.position).toBeUndefined();
      expect(child?.style.left).toBeUndefined();
      expect(child?.style.top).toBeUndefined();
    }
  });

  it("keeps a centred, max-width block child filling the body once it becomes a flex column", () => {
    const soleChildStyle = (child: string) => {
      const result = enableInlineScreenAutoLayout({
        content: `<!doctype html><html><body style="margin:0">${child}</body></html>`,
        width: 1440,
        height: 900,
      });
      expect(result.status).toBe("applied");
      const projection = buildCodeLayerProjection(result.content);
      const body = projection.nodes.find((node) => node.tag === "body");
      expect(body?.style["flex-direction"]).toBe("column");
      return projection.nodes.find((node) => node.id === body?.children[0])
        ?.style;
    };

    expect(
      soleChildStyle(
        `<main style="max-width:720px;margin:0 auto;padding:48px 32px">Main</main>`,
      ),
    ).toMatchObject({ width: "100%", "max-width": "720px", margin: "0 auto" });
    expect(
      soleChildStyle(`<aside style="width:200px;margin:0 auto">Fixed</aside>`)
        ?.width,
    ).toBe("200px");
    expect(
      soleChildStyle(`<span style="margin:0 auto">Inline</span>`)?.width,
    ).toBeUndefined();
  });

  it("uses one fragment root but rejects multiple roots instead of inventing a wrapper", () => {
    const single = buildCodeLayerProjection(
      `<main><section>Alpha</section></main>`,
    );
    expect(resolveInlineScreenAutoLayoutRoot(single)?.tag).toBe("main");

    const multiple = buildCodeLayerProjection(
      `<header>Header</header><main>Main</main>`,
    );
    expect(resolveInlineScreenAutoLayoutRoot(multiple)).toBeNull();
    expect(
      enableInlineScreenAutoLayout({
        content: `<header>Header</header><main>Main</main>`,
      }).status,
    ).toBe("unsupported");
  });

  it("enables auto layout on an empty authored body", () => {
    const result = enableInlineScreenAutoLayout({
      content: `<!doctype html><html><body></body></html>`,
    });
    expect(result.status).toBe("applied");
    expect(result.content).toContain("display: flex");
    expect(result.content).toContain("flex-direction: column");
  });

  it("finds the shallowest sourced React roots below an unsourced mount node", () => {
    const projection = buildCodeLayerProjection(`<!doctype html><html><body>
      <div id="root">
        <header data-agent-native-node-id="runtime-header" data-source-file="src/App.tsx" data-source-line="8" data-source-column="3">
          <span data-agent-native-node-id="runtime-title" data-source-file="src/App.tsx" data-source-line="9" data-source-column="5">Title</span>
        </header>
        <main data-agent-native-node-id="runtime-main" data-source-file="src/App.tsx" data-source-line="12" data-source-column="3">Main</main>
      </div>
      <div id="portal"><div data-agent-native-node-id="runtime-dialog" data-source-file="src/Dialog.tsx" data-source-line="4" data-source-column="3">Dialog</div></div>
    </body></html>`);

    const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
    expect(
      getRuntimeScreenAutoLayoutSubjectIds(projection).map(
        (id) => nodes.get(id)?.dataAttributes["data-agent-native-node-id"],
      ),
    ).toEqual(["runtime-header", "runtime-main"]);
  });

  it("refuses runtime roots without exact compiler provenance", () => {
    const projection = buildCodeLayerProjection(
      `<html><body><div id="root"><main data-source-file="src/App.tsx" data-source-line="8">Main</main></div></body></html>`,
    );
    expect(getRuntimeScreenAutoLayoutSubjectIds(projection)).toEqual([]);
  });
});

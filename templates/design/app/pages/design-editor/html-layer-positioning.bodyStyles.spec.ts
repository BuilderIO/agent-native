// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  removeAbsolutePositioningFromNodeInHtml,
  rawAbsoluteContainerOffsetFromDrop,
  setAbsolutePositioningForNodeInHtml,
  setFlowPositioningOverrideForNodeInHtml,
  setBodyInlineStyles,
  setScreenRootDefaultHeightMode,
  setScreenRootFrameRenderingStyles,
} from "@/pages/design-editor/html-layer-positioning";

describe("setBodyInlineStyles", () => {
  const doc = (body: string) =>
    `<!DOCTYPE html><html><head><title>S</title></head>${body}</html>`;

  it("adds a style attribute to a bare body", () => {
    expect(
      setBodyInlineStyles(doc("<body></body>"), {
        backgroundColor: "rgb(1, 2, 3)",
      }),
    ).toContain('<body style="background-color: rgb(1, 2, 3)">');
  });

  it("merges into existing declarations without disturbing the rest", () => {
    const next = setBodyInlineStyles(
      doc('<body style="margin: 0; background-color: red"><div>x</div></body>'),
      { backgroundColor: "blue" },
    );
    expect(next).toContain("margin: 0");
    expect(next).toContain("background-color: blue");
    expect(next).not.toContain("red");
    expect(next).toContain("<div>x</div>");
  });

  it("removes a declaration when cleared", () => {
    const next = setBodyInlineStyles(
      doc('<body style="margin: 0; background-color: red"></body>'),
      { backgroundColor: "" },
    );
    expect(next).toContain("margin: 0");
    expect(next).not.toContain("background-color");
  });

  it("drops the attribute entirely when nothing is left", () => {
    expect(
      setBodyInlineStyles(doc('<body style="background-color: red"></body>'), {
        backgroundColor: null,
      }),
    ).toContain("<body>");
  });

  it("fails loudly on a URL-backed screen instead of looking saved", () => {
    expect(
      setBodyInlineStyles("http://localhost:8210/", { color: "red" }),
    ).toBe(null);
  });

  it("survives a quoted '>' in another attribute", () => {
    const html = doc(
      `<body x-data="{ wide: a > b }" style="margin: 0"><div>x</div></body>`,
    );
    const next = setBodyInlineStyles(html, { backgroundColor: "red" });
    expect(next).toContain('x-data="{ wide: a > b }"');
    expect(next).toContain("background-color: red");
    expect(next).toContain("<div>x</div>");
  });

  it("rewrites an unquoted style attribute instead of adding a second one", () => {
    const next = setBodyInlineStyles(doc("<body style=margin:0></body>"), {
      backgroundColor: "red",
    });
    expect((next ?? "").match(/style=/g) ?? []).toHaveLength(1);
    expect(next).toContain("background-color: red");
    expect(next).toContain("margin: 0");
  });

  it("keeps a data: URL whole", () => {
    const url = "url(data:image/png;base64,AAAB)";
    const next = setBodyInlineStyles(
      doc(`<body style="background-image: ${url}"></body>`),
      { backgroundColor: "red" },
    );
    expect(next).toContain(url);
  });

  it("does not compound entities on repeated edits", () => {
    let html = doc(
      `<body style="background-image: url('a?x=1&amp;y=2')"></body>`,
    );
    for (let i = 0; i < 3; i += 1) {
      html = setBodyInlineStyles(html, { backgroundColor: `rgb(${i},0,0)` })!;
    }
    expect(html).toContain("&amp;y=2");
    expect(html).not.toContain("&amp;amp;");
  });

  it("clears a value the inspector read out of a shorthand", () => {
    const next = setBodyInlineStyles(
      doc(`<body style="background:#0f1115"></body>`),
      { backgroundColor: "" },
    );
    expect(next).not.toContain("0f1115");
  });

  it("leaves the document untouched when the patch changes nothing", () => {
    const content = doc('<body style="background-color: red"></body>');
    expect(setBodyInlineStyles(content, { backgroundColor: "red" })).toBe(
      content,
    );
  });
});

describe("setScreenRootFrameRenderingStyles", () => {
  const doc =
    '<!DOCTYPE html><html><head><title>Keep</title><style>.card{color:red}</style></head><body><main class="card">Text</main></body></html>';

  it("adds portable paint containment and clipping without changing authored head content", () => {
    const next = setScreenRootFrameRenderingStyles(doc, {
      contained: true,
      clipped: true,
      heightPinned: true,
    });
    expect(next).toContain(
      "<title>Keep</title><style>.card{color:red}</style><style data-agent-native-screen-frame-rendering>body{contain: paint;overflow: hidden;min-height: 100vh}</style>",
    );
    expect(next).toContain('<main class="card">Text</main>');
  });

  it("keeps Hug height natural and removes its managed rule when no longer needed", () => {
    const fixed = setScreenRootFrameRenderingStyles(doc, {
      contained: true,
      clipped: false,
      heightPinned: false,
    });
    expect(fixed).toContain(
      "<style data-agent-native-screen-frame-rendering>body{contain: paint}</style>",
    );
    expect(fixed).not.toContain("min-height: 100vh");
    expect(
      setScreenRootFrameRenderingStyles(fixed, {
        contained: false,
        clipped: false,
        heightPinned: false,
      }),
    ).toBe(doc);
  });

  it("replaces its prior rule without duplicating or deleting unrelated style blocks", () => {
    const first = setScreenRootFrameRenderingStyles(doc, {
      contained: true,
      clipped: true,
      heightPinned: false,
    });
    const second = setScreenRootFrameRenderingStyles(first, {
      contained: true,
      clipped: false,
      heightPinned: true,
    });
    expect(
      second.match(/data-agent-native-screen-frame-rendering/g),
    ).toHaveLength(1);
    expect(second).toContain("min-height: 100vh");
    expect(second).not.toContain("overflow: hidden");
    expect(second).toContain("<style>.card{color:red}</style>");
  });
});

describe("setScreenRootDefaultHeightMode", () => {
  const defaultScreen =
    "<!DOCTYPE html><html><head><style data-agent-native-screen-default-height>body { min-height: 100vh; }</style><style>body { max-height: 1200px; }</style></head><body></body></html>";

  it("removes only the blank Screen viewport floor in Hug mode", () => {
    const hug = setScreenRootDefaultHeightMode(defaultScreen, "hug");
    expect(hug).toContain(
      "<style data-agent-native-screen-default-height></style>",
    );
    expect(hug).toContain('<meta data-agent-native-screen-height-mode="hug">');
    expect(hug).not.toContain("min-height: 100vh");
    expect(hug).toContain("max-height: 1200px");
  });

  it("restores the owned viewport floor for Auto and Fixed modes", () => {
    const hug = setScreenRootDefaultHeightMode(defaultScreen, "hug");
    for (const mode of ["auto", "fixed"] as const) {
      const restored = setScreenRootDefaultHeightMode(hug, mode);
      expect(
        restored.match(/data-agent-native-screen-default-height/g),
      ).toHaveLength(1);
      expect(restored).toContain("body { min-height: 100vh; }");
      expect(restored).toContain("max-height: 1200px");
    }
  });

  it("marks imported roots for natural measurement without changing authored constraints", () => {
    const imported =
      "<!DOCTYPE html><html><head><style>body{min-height:80vh;max-height:900px}</style></head><body></body></html>";
    const hug = setScreenRootDefaultHeightMode(imported, "hug");
    expect(hug).toContain("body{min-height:80vh;max-height:900px}");
    expect(hug).toContain('<meta data-agent-native-screen-height-mode="hug">');
    expect(setScreenRootDefaultHeightMode(hug, "auto")).toBe(imported);
  });
});

describe("flow-insert positioning for code-backed Frames", () => {
  const frameHtml = (style: string, marker = "data-an-primitive") =>
    `<!DOCTYPE html><html><head></head><body><div data-agent-native-node-id="frame" ${marker}="frame" style="${style}"><span data-agent-native-node-id="badge" style="position:absolute;right:10px;bottom:13px"></span></div></body></html>`;

  it("keeps a marked Frame as the containing block and clears its old anchors", () => {
    const moved = removeAbsolutePositioningFromNodeInHtml(
      frameHtml(
        "position:absolute;inset:40px auto auto 40px;border-radius:50%",
      ),
      "frame",
    );
    const doc = new DOMParser().parseFromString(moved, "text/html");
    const frame = doc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="frame"]',
    )!;

    expect(frame.style.position).toBe("relative");
    expect(frame.style.left).toBe("auto");
    expect(frame.style.top).toBe("auto");
    expect(frame.style.right).toBe("auto");
    expect(frame.style.bottom).toBe("auto");
    expect(
      frame.querySelector('[data-agent-native-node-id="badge"]'),
    ).not.toBeNull();
  });

  it("persists relative important positioning for Frames but leaves authored non-Frames in flow", () => {
    const forcedFrame = setFlowPositioningOverrideForNodeInHtml(
      frameHtml(
        "position:absolute;inset:40px auto auto 40px",
        "data-agent-native-primitive",
      ),
      "frame",
    );
    const frameDoc = new DOMParser().parseFromString(forcedFrame, "text/html");
    const frame = frameDoc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="frame"]',
    )!;
    expect(frame.style.getPropertyValue("position")).toBe("relative");
    expect(frame.style.getPropertyPriority("position")).toBe("important");
    for (const prop of ["left", "top", "right", "bottom"] as const) {
      expect(frame.style.getPropertyValue(prop)).toBe("auto");
      expect(frame.style.getPropertyPriority(prop)).toBe("important");
    }

    const authored = removeAbsolutePositioningFromNodeInHtml(
      '<!DOCTYPE html><html><head></head><body><div data-agent-native-node-id="plain" style="position:absolute;inset:20px"></div></body></html>',
      "plain",
    );
    const authoredDoc = new DOMParser().parseFromString(authored, "text/html");
    const plain = authoredDoc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="plain"]',
    )!;
    expect(plain.style.position).toBe("");
    expect(plain.style.left).toBe("");
    expect(plain.style.top).toBe("");

    const forcedPlain = setFlowPositioningOverrideForNodeInHtml(
      authored,
      "plain",
    );
    const forcedPlainDoc = new DOMParser().parseFromString(
      forcedPlain,
      "text/html",
    );
    const forcedPlainElement = forcedPlainDoc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="plain"]',
    )!;
    expect(forcedPlainElement.style.position).toBe("static");
    expect(forcedPlainElement.style.getPropertyPriority("position")).toBe(
      "important",
    );
  });
});

describe("node positioning source shape", () => {
  const withoutTargetStyleAttribute = (html: string) =>
    html.replace(
      /<[^>]*data-agent-native-node-id="moving-node"[^>]*>/gi,
      (openTag) => {
        const withoutStyle = openTag.replace(
          /\sstyle=(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
          "",
        );
        return withoutStyle === openTag
          ? withoutStyle.replace(/\s+>/, ">")
          : withoutStyle;
      },
    );

  const writers = [
    (html: string) =>
      removeAbsolutePositioningFromNodeInHtml(html, "moving-node"),
    (html: string) =>
      setFlowPositioningOverrideForNodeInHtml(html, "moving-node"),
    (html: string) =>
      setAbsolutePositioningForNodeInHtml(html, "moving-node", {
        x: 31,
        y: 47,
      }),
  ];

  it("changes only the target style attribute in fragments and documents", () => {
    const fragment =
      '<main data-note="preserve > and spacing">\n<!-- keep -->\n<div data-agent-native-node-id="styled-sibling" style="color: purple; margin: 4px">Sibling</div>\n<div data-agent-native-node-id="moving-node" data-keep="yes" style="position:absolute;left:1px;top:2px">Text</div>\n</main>';
    const document =
      '<!DOCTYPE html>\n<html><head><title>Keep</title></head><body>\n<!-- keep -->\n<div data-agent-native-node-id="styled-sibling" style="color: purple; margin: 4px">Sibling</div>\n<div data-agent-native-node-id="moving-node" data-keep="yes" style="position:absolute;left:1px;top:2px">Text</div>\n</body></html>';

    for (const content of [fragment, document]) {
      for (const writePositioning of writers) {
        const next = writePositioning(content);
        expect(withoutTargetStyleAttribute(next)).toBe(
          withoutTargetStyleAttribute(content),
        );
        expect(next).toContain('data-keep="yes"');
        expect(next).toContain("<!-- keep -->");
        expect(next).toContain('style="color: purple; margin: 4px"');
      }
    }

    const [removed, flow, absolute] = writers.map((writePositioning) =>
      writePositioning(fragment),
    );
    const removedTarget = new DOMParser()
      .parseFromString(removed!, "text/html")
      .querySelector<HTMLElement>('[data-agent-native-node-id="moving-node"]');
    const flowTarget = new DOMParser()
      .parseFromString(flow!, "text/html")
      .querySelector<HTMLElement>('[data-agent-native-node-id="moving-node"]');
    const absoluteTarget = new DOMParser()
      .parseFromString(absolute!, "text/html")
      .querySelector<HTMLElement>('[data-agent-native-node-id="moving-node"]');
    expect(removedTarget?.style.position).toBe("");
    expect(flowTarget?.style.position).toBe("static");
    expect(flowTarget?.style.getPropertyPriority("position")).toBe("important");
    expect(absoluteTarget?.style.position).toBe("absolute");
    expect(absoluteTarget?.style.left).toBe("31px");
    expect(absoluteTarget?.style.top).toBe("47px");
    expect(removed).not.toMatch(/^<!DOCTYPE html>/i);
    expect(flow).not.toMatch(/^<!DOCTYPE html>/i);
    expect(absolute).not.toMatch(/^<!DOCTYPE html>/i);
    expect(writers[0]!(document)).toMatch(/^<!DOCTYPE html>/i);
    expect(writers[1]!(document)).toMatch(/^<!DOCTYPE html>/i);
    expect(writers[2]!(document)).toMatch(/^<!DOCTYPE html>/i);
  });

  it("refuses every positioning write when the stable id is ambiguous", () => {
    const ambiguous =
      '<main><div data-agent-native-node-id="moving-node" style="position:absolute;left:1px;top:2px"></div><span data-agent-native-node-id="moving-node" style="position:absolute;left:3px;top:4px"></span></main>';

    for (const writePositioning of writers) {
      expect(writePositioning(ambiguous)).toBe(ambiguous);
    }
  });
});

describe("rawAbsoluteContainerOffsetFromDrop", () => {
  it("uses rebased inline left/top for a sibling un-nest", () => {
    expect(
      rawAbsoluteContainerOffsetFromDrop({
        dropMode: "absolute-container",
        placement: "after",
        sourceRect: { x: 3803, y: 3921 },
        anchorRect: { x: 40, y: 40 },
        inlineStyles: { left: "260px", top: "80px" },
      }),
    ).toEqual({ x: 260, y: 80 });
  });

  it("keeps sourceRect − anchorRect for an inside nest", () => {
    expect(
      rawAbsoluteContainerOffsetFromDrop({
        dropMode: "absolute-container",
        placement: "inside",
        sourceRect: { x: 120, y: 80 },
        anchorRect: { x: 40, y: 40 },
        inlineStyles: { left: "999px", top: "999px" },
      }),
    ).toEqual({ x: 80, y: 40 });
  });

  it("uses rebased inline left/top for an inside drop on html > body", () => {
    expect(
      rawAbsoluteContainerOffsetFromDrop({
        dropMode: "absolute-container",
        placement: "inside",
        sourceRect: { x: 3803, y: 3921 },
        anchorRect: { x: 0, y: 0 },
        inlineStyles: { left: "260px", top: "80px" },
        anchorSelector: "html > body",
      }),
    ).toEqual({ x: 260, y: 80 });
  });
});

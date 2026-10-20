// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  adaptAutoTextColorForCrossScreenNode,
  BOARD_TEXT_AUTO_COLOR_MARKER,
} from "./cross-screen-text-color";

describe("adaptAutoTextColorForCrossScreenNode", () => {
  it("adapts auto-selected black text when it moves to a dark screen", () => {
    const content = `<!doctype html><html><body>
      <div data-agent-native-node-id="screen" style="background:#111111">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </div>
    </body></html>`;

    const adapted = adaptAutoTextColorForCrossScreenNode(content, "text");
    const doc = new DOMParser().parseFromString(adapted, "text/html");
    const text = doc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="text"]',
    );

    expect(text?.style.color).toBe("#ffffff");
    expect(text?.ownerDocument.defaultView?.getComputedStyle(text).color).toBe(
      "#ffffff",
    );
    expect(text?.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER)).toBe(true);
  });

  it("uses a live destination container when the moved text is not rendered yet", () => {
    const content = `<!doctype html><html><head><style>
      .destination-surface { background: #111111; }
    </style></head><body>
      <main data-agent-native-node-id="target" class="destination-surface">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;
    const liveDestDoc = new DOMParser().parseFromString(
      `<!doctype html><html><head><style>
        .destination-surface { background: #111111; }
      </style></head><body>
        <main data-agent-native-node-id="target" class="destination-surface"></main>
      </body></html>`,
      "text/html",
    );

    const adapted = adaptAutoTextColorForCrossScreenNode(
      content,
      "text",
      liveDestDoc,
    );
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      liveDestDoc.defaultView?.getComputedStyle(
        liveDestDoc.querySelector('[data-agent-native-node-id="target"]')!,
      ).backgroundColor,
    ).toBe("#111111");
    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#ffffff");
  });

  it("matches a live destination container by authored id for stylesheet backgrounds", () => {
    const content = `<!doctype html><html><head><style>
      #destination { background: #111111; }
    </style></head><body>
      <main id="destination">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;
    const liveDestDoc = new DOMParser().parseFromString(
      `<!doctype html><html><head><style>
        #destination { background: #111111; }
      </style></head><body>
        <main id="destination"></main>
      </body></html>`,
      "text/html",
    );

    const adapted = adaptAutoTextColorForCrossScreenNode(
      content,
      "text",
      liveDestDoc,
    );
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      liveDestDoc.defaultView?.getComputedStyle(
        liveDestDoc.getElementById("destination")!,
      ).backgroundColor,
    ).toBe("#111111");
    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#ffffff");
  });

  it("does not sample an unrelated live element when authored ids collide", () => {
    const content = `<!doctype html><html><body style="background:#ffffff">
      <main id="destination">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;
    const liveDestDoc = new DOMParser().parseFromString(
      `<!doctype html><html><head><style>
        .unrelated-dark-surface { background: #111111; }
      </style></head><body style="background:#ffffff">
        <div id="destination" class="unrelated-dark-surface"></div>
        <main id="destination" style="background:#ffffff"></main>
      </body></html>`,
      "text/html",
    );

    const adapted = adaptAutoTextColorForCrossScreenNode(
      content,
      "text",
      liveDestDoc,
    );
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#000000");
  });

  it("inherits through a transparent inline background instead of using its class hint", () => {
    const content = `<!doctype html><html><body style="background:#111111">
      <main class="bg-white" style="background:transparent">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;

    const adapted = adaptAutoTextColorForCrossScreenNode(content, "text");
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#ffffff");
  });

  it("inherits through a transparent computed background instead of using its class hint", () => {
    const content = `<!doctype html><html><body>
      <main data-agent-native-node-id="target" class="bg-white" style="background:transparent">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;
    const liveDestDoc = new DOMParser().parseFromString(
      `<!doctype html><html><body style="background:#111111">
        <main data-agent-native-node-id="target" class="bg-white" style="background:transparent"></main>
      </body></html>`,
      "text/html",
    );

    const adapted = adaptAutoTextColorForCrossScreenNode(
      content,
      "text",
      liveDestDoc,
    );
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      liveDestDoc.defaultView?.getComputedStyle(
        liveDestDoc.querySelector('[data-agent-native-node-id="target"]')!,
      ).backgroundColor,
    ).toBe("transparent");
    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#ffffff");
  });

  it("uses an inherited CSS variable to resolve a background utility opacity hint", () => {
    const content = `<!doctype html><html><body style="--surface-opacity:0.85;background:#ffffff">
      <main class="bg-slate-900/[var(--surface-opacity)]">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;

    const adapted = adaptAutoTextColorForCrossScreenNode(content, "text");
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#ffffff");

    const translucentContent = content.replace(
      "--surface-opacity:0.85",
      "--surface-opacity:0.2",
    );
    const translucent = adaptAutoTextColorForCrossScreenNode(
      translucentContent,
      "text",
    );
    const translucentDoc = new DOMParser().parseFromString(
      translucent,
      "text/html",
    );
    expect(
      translucentDoc.querySelector<HTMLElement>(
        '[data-agent-native-node-id="text"]',
      )?.style.color,
    ).toBe("#000000");
  });

  it("keeps a palette hint for unresolved stylesheet opacity without a live destination", () => {
    const content = `<!doctype html><html><head><style>
      :root { --surface-opacity: 0.85; }
    </style></head><body style="background:#ffffff">
      <main class="bg-slate-900/[var(--surface-opacity)]">
        <span data-agent-native-node-id="text" data-an-primitive="text" ${BOARD_TEXT_AUTO_COLOR_MARKER} style="color:#000000">Text</span>
      </main>
    </body></html>`;

    const adapted = adaptAutoTextColorForCrossScreenNode(content, "text");
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      doc.querySelector<HTMLElement>('[data-agent-native-node-id="text"]')
        ?.style.color,
    ).toBe("#ffffff");
  });

  it("adapts legacy white text descendants while preserving explicit descendant colors", () => {
    const content = `<!doctype html><html><body style="background:#ffffff">
      <section data-agent-native-node-id="container" data-an-primitive="group">
        <span data-agent-native-node-id="legacy-text" data-an-primitive="text" style="color:#ffffff">Legacy</span>
        <span data-agent-native-node-id="explicit-text" data-an-primitive="text" style="color:#f00000">Explicit</span>
      </section>
    </body></html>`;

    const adapted = adaptAutoTextColorForCrossScreenNode(content, "container");
    const doc = new DOMParser().parseFromString(adapted, "text/html");

    expect(
      doc.querySelector<HTMLElement>(
        '[data-agent-native-node-id="legacy-text"]',
      )?.style.color,
    ).toBe("#000000");
    expect(
      doc
        .querySelector('[data-agent-native-node-id="legacy-text"]')
        ?.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER),
    ).toBe(true);
    expect(
      doc.querySelector<HTMLElement>(
        '[data-agent-native-node-id="explicit-text"]',
      )?.style.color,
    ).toBe("#f00000");
  });

  it("keeps legacy white text auto-colored when moved from a light screen to a dark screen", () => {
    const lightContent = `<!doctype html><html><body style="background:#ffffff">
      <span data-agent-native-node-id="legacy-text" data-an-primitive="text" style="color:#ffffff">Legacy</span>
    </body></html>`;

    const afterLightMove = adaptAutoTextColorForCrossScreenNode(
      lightContent,
      "legacy-text",
    );
    const lightDoc = new DOMParser().parseFromString(
      afterLightMove,
      "text/html",
    );
    const movedText = lightDoc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="legacy-text"]',
    )!;

    expect(movedText.style.color).toBe("#000000");
    expect(movedText.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER)).toBe(true);

    const darkContent = `<!doctype html><html><body style="background:#111111">
      ${movedText.outerHTML}
    </body></html>`;
    const afterDarkMove = adaptAutoTextColorForCrossScreenNode(
      darkContent,
      "legacy-text",
    );
    const darkDoc = new DOMParser().parseFromString(afterDarkMove, "text/html");
    const darkText = darkDoc.querySelector<HTMLElement>(
      '[data-agent-native-node-id="legacy-text"]',
    );

    expect(darkText?.style.color).toBe("#ffffff");
    expect(darkText?.hasAttribute(BOARD_TEXT_AUTO_COLOR_MARKER)).toBe(true);
  });
});

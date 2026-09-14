// @vitest-environment happy-dom
/**
 * Regression coverage for the cross-screen alt-drag duplicate bug: a dropped
 * copy carried an unrelated ~50-property computed-style dump (position,
 * width, height, opacity, z-index, transform:none, ...) instead of just the
 * appearance the source inherited from its old stylesheet context, and
 * `position` in that dump raced the drop's own placement write. See
 * app/pages/design-editor/commands/cross-screen-element-drop.ts (the
 * `applyPortableStyleSnapshotToHtml` call) and editor-chrome.bridge.ts's
 * `collectPortableComputedStyles`, which now diffs against a bare-tag probe
 * before including a property. The diffing itself needs a real browser and
 * can't run here (see portable-style.ts's own DOMParser dependency), so
 * these tests pin the DOM-independent contract: a snapshot's properties are
 * applied to the destination node, and `position` is never one of them.
 */
import { describe, expect, it } from "vitest";

import {
  applyPortableStyles,
  applyPortableStyleSnapshotToHtml,
} from "./portable-style";

describe("applyPortableStyles", () => {
  it("never sets position, even when a (malformed) snapshot includes it", () => {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "40px";
    el.style.top = "20px";
    applyPortableStyles(el, {
      position: "static",
      color: "rgb(10, 20, 30)",
      fontFamily: "Georgia",
    });
    // Appearance properties land...
    expect(el.style.color).toBe("rgb(10, 20, 30)");
    expect(el.style.fontFamily).toBe("Georgia");
    // ...but position/left/top, which the drop itself owns, are untouched.
    expect(el.style.position).toBe("absolute");
    expect(el.style.left).toBe("40px");
    expect(el.style.top).toBe("20px");
  });

  it("still filters editor-internal CSS custom properties", () => {
    const el = document.createElement("div");
    applyPortableStyles(el, {
      "--design-editor-accent-color": "red",
      "--brand-primary-500": "blue",
    });
    expect(el.style.getPropertyValue("--design-editor-accent-color")).toBe("");
    expect(el.style.getPropertyValue("--brand-primary-500")).toBe("blue");
  });
});

describe("applyPortableStyleSnapshotToHtml", () => {
  // A source dropped inside a styled parent (dark card: white text, serif
  // font) that never authored those properties itself — they were inherited.
  // Once diffed against tag defaults, a correct snapshot carries only the
  // inherited appearance (color, fontFamily), never position/box properties.
  const DEST_BARE_SCREEN = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="dropped" style="position:absolute;left:12px;top:8px;"></div>
</body></html>`;

  it("applies only the carried appearance properties, never position/box properties", () => {
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      {
        version: 1,
        rootSourceId: "dropped",
        nodes: [
          {
            sourceId: "dropped",
            path: [],
            styles: {
              color: "rgb(255, 255, 255)",
              fontFamily: "Georgia",
              // Same size as the source is correct duplicate/move semantics
              // ("same appearance, only position differs") and must survive.
              width: "60px",
              height: "60px",
              // A stale/legacy snapshot might still carry this — the apply
              // boundary must drop it regardless of what collection sends,
              // since the drop itself already decided where this node sits.
              position: "static",
            },
          },
        ],
      },
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const dropped = doc.querySelector(
      '[data-agent-native-node-id="dropped"]',
    ) as HTMLElement;
    expect(dropped.style.color).toBe("rgb(255, 255, 255)");
    expect(dropped.style.fontFamily).toBe("Georgia");
    expect(dropped.style.width).toBe("60px");
    expect(dropped.style.height).toBe("60px");
    // The drop already placed this node absolutely — the snapshot must not
    // have touched position/left/top.
    expect(dropped.style.position).toBe("absolute");
    expect(dropped.style.left).toBe("12px");
    expect(dropped.style.top).toBe("8px");
  });

  it("applies a class-authored width/height to a destination with no source stylesheet, leaving an auto-sized child fluid", () => {
    // The destination has no `.card` rule at all — same shape as a
    // cross-screen move (see editor-chrome.bridge.ts's
    // resolvePortableBoxSizeValue / portable-style-snapshot.bridge.spec.ts
    // for how the source captures this).
    const destWithChild = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head><body>
<div data-agent-native-node-id="dropped" style="position:absolute;left:12px;top:8px;">
  <div data-agent-native-node-id="dropped-child"></div>
</div>
</body></html>`;
    const result = applyPortableStyleSnapshotToHtml(destWithChild, "dropped", {
      version: 1,
      rootSourceId: "dropped",
      nodes: [
        {
          sourceId: "dropped",
          path: [],
          styles: { width: "320px", height: "200px" },
        },
        {
          // A plain flow/flex child the source capture never assigned a
          // size to (no matching rule) — nothing here should freeze it.
          sourceId: "dropped-child",
          path: [0],
          styles: {},
        },
      ],
    });
    const doc = new DOMParser().parseFromString(result, "text/html");
    const dropped = doc.querySelector(
      '[data-agent-native-node-id="dropped"]',
    ) as HTMLElement;
    const child = doc.querySelector(
      '[data-agent-native-node-id="dropped-child"]',
    ) as HTMLElement;
    expect(dropped.style.width).toBe("320px");
    expect(dropped.style.height).toBe("200px");
    expect(child.style.width).toBe("");
    expect(child.style.height).toBe("");
  });

  it("applies the snapshot even when source and destination share an identical stylesheet head", () => {
    // Regression: an earlier `sameStylesheetHead` short-circuit skipped
    // applying the snapshot whenever source/dest <head> markup matched
    // exactly. Identical heads don't prove an identical cascade — here both
    // documents load the SAME `.card { color: white }` rule, but only the
    // source's <body> carries `.dark`, so the destination's `.card` never
    // matches and the node would render with the inherited default (near-
    // black) instead of white if the snapshot were skipped.
    const sharedHead = `<head><meta charset="UTF-8"><style>.dark .card { color: white; }</style></head>`;
    const sourceHtml = `<!DOCTYPE html>\n<html lang="en">${sharedHead}<body class="dark"><div class="card" data-agent-native-node-id="dropped"></div></body></html>`;
    const destHtml = `<!DOCTYPE html>\n<html lang="en">${sharedHead}<body><div class="card" data-agent-native-node-id="dropped" style="position:absolute;left:12px;top:8px;"></div></body></html>`;
    const result = applyPortableStyleSnapshotToHtml(destHtml, "dropped", {
      version: 1,
      rootSourceId: "dropped",
      nodes: [
        {
          sourceId: "dropped",
          path: [],
          styles: { color: "rgb(255, 255, 255)" },
        },
      ],
    });
    const doc = new DOMParser().parseFromString(result, "text/html");
    const dropped = doc.querySelector(
      '[data-agent-native-node-id="dropped"]',
    ) as HTMLElement;
    expect(dropped.style.color).toBe("rgb(255, 255, 255)");
  });

  it("is a no-op when the snapshot has nothing left after filtering", () => {
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      {
        version: 1,
        rootSourceId: "dropped",
        nodes: [
          { sourceId: "dropped", path: [], styles: { position: "absolute" } },
        ],
      },
    );
    expect(result).toBe(DEST_BARE_SCREEN);
  });

  it("is a safe no-op for a LEGITIMATELY absent snapshot (nothing to carry) — not a lost/corrupted node", () => {
    // `undefined` means "nothing to carry" (isDocumentRootElement / no root /
    // not asked for) — this is the ordinary case for e.g. a paste or a drop
    // whose source never had a portable-style snapshot at all, and this
    // function's job is only to apply what it was given, safely, never to
    // decide whether the move itself should proceed.
    //
    // A CAPTURE FAILURE (the bare-tag probe iframe couldn't be created) is a
    // different value entirely — the bridge marks it with the
    // `styleSnapshotCaptureFailed` flag alongside `styleSnapshot: null` — and
    // is refused at the command boundary in cross-screen-element-drop.ts
    // BEFORE this function is ever called, so a capture failure never reaches
    // here as a plain `undefined`. See
    // "runCrossScreenElementDrop — portable style capture failure" in
    // cross-screen-element-drop.spec.ts for that refusal contract.
    const result = applyPortableStyleSnapshotToHtml(
      DEST_BARE_SCREEN,
      "dropped",
      undefined,
    );
    expect(result).toBe(DEST_BARE_SCREEN);
  });
});

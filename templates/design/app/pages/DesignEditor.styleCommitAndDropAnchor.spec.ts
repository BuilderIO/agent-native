/**
 * DesignEditor.styleCommitAndDropAnchor.spec.ts
 *
 * Regression coverage for two DnD-hardening round-2 fixes:
 *
 * 1. Fail-loud style commits (resolveVisualStyleCommitContent): scrubbing a
 *    style control on an element whose commit target can't be resolved (e.g.
 *    an Alpine `<template x-for>` instance with no per-instance source node)
 *    used to silently no-op — patch-proof flipped to "failed" with no toast
 *    while the inspector kept the new value. The pure resolution helper now
 *    pins the commit-or-error contract commitVisualStyles surfaces loudly.
 *
 * 2. Cross-screen id-on-demand anchor handshake: the hit-test bridge mints a
 *    pendingNodeId + source-equivalent anchorSelector for id-less anchors;
 *    handleCrossScreenElementDrop persists the pending id via a STRICT
 *    attribute stamp (unique match or conflict) before resolving the drop.
 *    These tests pin the stamp-then-move sequence at the code-layer level,
 *    including the "ambiguous selector must NOT stamp" safety property that
 *    prevents wrong-node writes.
 */
import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  moveNodeBetweenDocuments,
} from "../../shared/code-layer";
import { resolveVisualStyleCommitContent } from "./DesignEditor";

describe("resolveVisualStyleCommitContent (fail-loud contract)", () => {
  it("returns the scoped content when the scoped patch applied", () => {
    expect(
      resolveVisualStyleCommitContent({
        scopedContent: "<body>scoped</body>",
        scopedFailure: null,
        legacyFallbackContent: "<body>legacy</body>",
        breakpointScoped: false,
      }),
    ).toEqual({ content: "<body>scoped</body>" });
  });

  it("hard-errors on breakpoint scope even when a legacy fallback exists (never widen a scoped edit)", () => {
    expect(
      resolveVisualStyleCommitContent({
        scopedContent: "<body>unused</body>",
        scopedFailure: "did not match a code layer node",
        legacyFallbackContent: "<body>legacy</body>",
        breakpointScoped: true,
      }),
    ).toEqual({ error: "did not match a code layer node" });
  });

  it("uses the legacy unique-selector fallback on base scope", () => {
    expect(
      resolveVisualStyleCommitContent({
        scopedContent: "<body>unused</body>",
        scopedFailure: "did not match a code layer node",
        legacyFallbackContent: "<body>legacy</body>",
        breakpointScoped: false,
      }),
    ).toEqual({ content: "<body>legacy</body>" });
  });

  it("hard-errors when nothing resolved (template-instance Gap scrub case)", () => {
    expect(
      resolveVisualStyleCommitContent({
        scopedContent: "<body>unused</body>",
        scopedFailure: "The selected element no longer exists in this screen.",
        legacyFallbackContent: null,
        breakpointScoped: false,
      }),
    ).toEqual({
      error: "The selected element no longer exists in this screen.",
    });
  });
});

describe("cross-screen id-on-demand anchor handshake (stamp then move)", () => {
  // Mirrors a fresh AI-generated screen: no data-agent-native-node-id
  // anywhere, one static container plus an Alpine template repeater.
  const destHtml =
    `<body>` +
    `<div class="flex flex-col"><span>a</span><span>b</span></div>` +
    `<ul><template x-for="t in tasks"><li>Task</li></template></ul>` +
    `</body>`;
  const sourceHtml = `<body><div data-agent-native-node-id="moving">Move me</div></body>`;

  it("stamps the pending id via a body-rooted structural selector, then the move flow-inserts against it", () => {
    const stamped = applyVisualEdit(destHtml, {
      kind: "attribute",
      target: { selector: "body > div:nth-of-type(1)" },
      name: "data-agent-native-node-id",
      value: "an-pending-test1",
    });
    expect(stamped.result.status).toBe("applied");
    expect(stamped.content).toContain(
      'data-agent-native-node-id="an-pending-test1"',
    );

    const moved = moveNodeBetweenDocuments(sourceHtml, stamped.content, {
      nodeId: "moving",
      anchorNodeId: "an-pending-test1",
      placement: "inside",
    });
    expect(moved.status).toBe("applied");
    // Landed INSIDE the stamped container, not body-appended.
    const container = moved.destHtml.slice(
      moved.destHtml.indexOf("an-pending-test1"),
      moved.destHtml.indexOf("</div>") + "</div>".length,
    );
    expect(container).toContain("Move me");
  });

  it("refuses to stamp when the selector is ambiguous (no wrong-node writes)", () => {
    const twoDivs =
      `<body><section>` +
      `<div class="x"><div class="x"></div></div>` +
      `</section></body>`;
    // ".x" alone matches two nodes — strict resolution must conflict.
    const stamped = applyVisualEdit(twoDivs, {
      kind: "attribute",
      target: { selector: "div.x" },
      name: "data-agent-native-node-id",
      value: "an-pending-test2",
    });
    expect(stamped.result.status).not.toBe("applied");
    expect(stamped.content ?? twoDivs).not.toContain("an-pending-test2");
  });

  it("nth indexes resolve against source-visible elements only (template excluded), matching the bridge's clone-skipping selector", () => {
    // The template's <li> children are invisible to the projection; the ul is
    // ul:nth-of-type(1) and the div is div:nth-of-type(1) regardless of the
    // runtime clones Alpine would add between them in the live DOM.
    const stamped = applyVisualEdit(destHtml, {
      kind: "attribute",
      target: { selector: "body > ul:nth-of-type(1)" },
      name: "data-agent-native-node-id",
      value: "an-pending-ul",
    });
    expect(stamped.result.status).toBe("applied");
    expect(stamped.content).toMatch(/<ul[^>]*an-pending-ul/);
  });
});

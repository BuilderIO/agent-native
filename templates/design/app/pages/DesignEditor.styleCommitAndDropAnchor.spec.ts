import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  moveNodeBetweenDocuments,
} from "../../shared/code-layer";
import { resolveVisualStyleCommitContent } from "./design-editor/pending-edits";

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

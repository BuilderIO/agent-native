import { describe, expect, it } from "vitest";

import type { PendingLiveStructureEdit } from "./pending-edits";
import {
  isPendingStructureDropNoOp,
  partitionPendingStructuresRuntime,
  verifyPendingStructureRuntime,
  verifyPendingStructuresRuntime,
} from "./pending-structure-verification";

function edit(
  overrides: Partial<PendingLiveStructureEdit> = {},
): PendingLiveStructureEdit {
  return {
    kind: "structure",
    screenId: "home",
    filename: "home",
    screenName: "Home",
    selector: "#subject",
    sourceId: "subject",
    anchorSelector: "#anchor",
    anchorSourceId: "anchor",
    placement: "inside",
    dropMode: "flow-insert",
    updatedAt: 1,
    ...overrides,
  };
}

describe("verifyPendingStructureRuntime", () => {
  it("proves inside flow insertion and rejects an absolute remount", () => {
    const flow = `<!doctype html><body>
      <section id="anchor" data-agent-native-node-id="anchor" style="display:flex">
        <div id="subject" data-agent-native-node-id="subject" style="position:static">Subject</div>
      </section>
    </body>`;
    expect(verifyPendingStructureRuntime(flow, edit())).toEqual({ ok: true });

    const absolute = flow.replace("position:static", "position:absolute");
    expect(verifyPendingStructureRuntime(absolute, edit())).toEqual({
      ok: false,
      failure: "wrong-drop-mode",
    });
  });

  it("proves absolute-container nesting", () => {
    const html = `<!doctype html><body>
      <section id="anchor" data-agent-native-node-id="anchor" style="position:relative">
        <div id="subject" data-agent-native-node-id="subject" style="position:absolute;left:40px;top:20px">Subject</div>
      </section>
    </body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({ dropMode: "absolute-container" }),
      ),
    ).toEqual({ ok: true });
  });

  it("does not discard same-parent absolute-container moves as no-ops", () => {
    const html = `<!doctype html><body>
      <section id="anchor" data-agent-native-node-id="anchor" style="position:relative">
        <div id="subject" data-agent-native-node-id="subject" style="position:absolute;left:40px;top:20px">Subject</div>
      </section>
    </body>`;
    expect(
      isPendingStructureDropNoOp(
        html,
        edit({ dropMode: "absolute-container" }),
      ),
    ).toBe(false);
  });

  it("requires exact before/between/after order", () => {
    const html = `<!doctype html><body><main data-agent-native-node-id="parent">
      <div data-agent-native-node-id="first">First</div>
      <div id="subject" data-agent-native-node-id="subject">Subject</div>
      <div id="anchor" data-agent-native-node-id="anchor">Anchor</div>
      <div data-agent-native-node-id="last">Last</div>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(html, edit({ placement: "before" })),
    ).toEqual({ ok: true });
    expect(
      verifyPendingStructureRuntime(html, edit({ placement: "after" })),
    ).toEqual({ ok: false, failure: "wrong-order" });
  });

  it("falls back to unique signatures when HMR changes sibling ids and tags", () => {
    const html = `<!doctype html><body><main>
      <button data-agent-native-node-id="new-anchor">Create</button>
      <h2 data-agent-native-node-id="new-subject">No decks yet</h2>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          selector: '[data-agent-native-node-id="old-subject"]',
          sourceId: "old-subject",
          anchorSelector: '[data-agent-native-node-id="old-anchor"]',
          anchorSourceId: "old-anchor",
          placement: "after",
          subjectSignature: {
            tag: "h2",
            text: "No decks yet",
            classes: [],
            component: "EmptyState",
          },
          anchorSignature: {
            tag: "button",
            text: "Create",
            classes: [],
            component: "EmptyState",
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("uses signatures to follow same-type keyless siblings after a swap", () => {
    const html = `<!doctype html><body><main>
      <div data-agent-native-node-id="new-anchor">Second</div>
      <div data-agent-native-node-id="new-subject">First</div>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          selector: '[data-agent-native-node-id="old-subject"]',
          sourceId: "old-subject",
          anchorSelector: '[data-agent-native-node-id="old-anchor"]',
          anchorSourceId: "old-anchor",
          placement: "after",
          subjectSignature: { tag: "div", text: "First", classes: [] },
          anchorSignature: { tag: "div", text: "Second", classes: [] },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("refuses an ambiguous signature instead of guessing a sibling", () => {
    const html = `<!doctype html><body><main>
      <div data-agent-native-node-id="new-one">Duplicate</div>
      <div data-agent-native-node-id="new-two">Duplicate</div>
      <button data-agent-native-node-id="new-anchor">Anchor</button>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          selector: '[data-agent-native-node-id="old-subject"]',
          sourceId: "old-subject",
          subjectSignature: { tag: "div", text: "Duplicate", classes: [] },
        }),
      ),
    ).toEqual({ ok: false, failure: "ambiguous-subject" });
  });

  it("uses a unique signature to detect a renamed removed subject", () => {
    const html = `<!doctype html><body>
      <button data-agent-native-node-id="new-button">Delete</button>
    </body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          selector: '[data-agent-native-node-id="old-button"]',
          sourceId: "old-button",
          removed: true,
          subjectSignature: { tag: "button", text: "Delete", classes: [] },
        }),
      ),
    ).toEqual({ ok: false, failure: "subject-still-present" });
  });

  it("does not acknowledge removal when the stable subject changed shape", () => {
    const html = `<!doctype html><body>
      <button data-agent-native-node-id="subject">Changed</button>
    </body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          selector: '[data-agent-native-node-id="subject"]',
          sourceId: "subject",
          removed: true,
          subjectSignature: { tag: "button", text: "Original", classes: [] },
        }),
      ),
    ).toEqual({ ok: false, failure: "subject-still-present" });
  });

  it("does not use an unrelated sibling when a stable subject changed shape", () => {
    const html = `<!doctype html><body><main>
      <div data-agent-native-node-id="subject">Changed</div>
      <div data-agent-native-node-id="old-match">Original</div>
      <div data-agent-native-node-id="anchor">Anchor</div>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          subjectSignature: { tag: "div", text: "Original", classes: [] },
        }),
      ),
    ).toEqual({ ok: false, failure: "subject-still-present" });
  });

  it("deduplicates repeated class tokens before matching a signature", () => {
    const html = `<!doctype html><body><main>
      <div data-agent-native-node-id="new-subject" class="a a b">Subject</div>
      <div data-agent-native-node-id="anchor">Anchor</div>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({
          selector: '[data-agent-native-node-id="old-subject"]',
          sourceId: "old-subject",
          anchorSelector: '[data-agent-native-node-id="anchor"]',
          anchorSourceId: "anchor",
          placement: "before",
          subjectSignature: {
            tag: "div",
            text: "Subject",
            classes: ["a", "b"],
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("recognizes a drop that already has the requested order as a no-op", () => {
    const html = `<!doctype html><body><main>
      <div data-agent-native-node-id="subject">First</div>
      <div data-agent-native-node-id="anchor">Second</div>
    </main></body>`;
    expect(
      isPendingStructureDropNoOp(
        html,
        edit({
          selector: '[data-agent-native-node-id="subject"]',
          sourceId: "subject",
          anchorSelector: '[data-agent-native-node-id="anchor"]',
          anchorSourceId: "anchor",
          placement: "before",
        }),
      ),
    ).toBe(true);
  });

  it("proves a replacement by the new identity and the old identity's absence", () => {
    const replacement = `<!doctype html><body>
      <section data-agent-native-node-id="replacement">Replacement</section>
    </body>`;
    const replaceEdit = edit({
      selector: "#subject",
      sourceId: "subject",
      anchorSelector: "",
      anchorSourceId: null,
      insertedHtml:
        '<section data-agent-native-node-id="replacement">Replacement</section>',
      replaced: true,
      replacementSelector: '[data-agent-native-node-id="replacement"]',
      replacementSourceId: "replacement",
      replacementSignature: {
        tag: "section",
        text: "Replacement",
        classes: [],
      },
    });

    expect(verifyPendingStructureRuntime(replacement, replaceEdit)).toEqual({
      ok: true,
    });
    expect(
      verifyPendingStructureRuntime(
        replacement.replace(
          "</body>",
          '<div data-agent-native-node-id="subject"></div></body>',
        ),
        replaceEdit,
      ),
    ).toEqual({ ok: false, failure: "subject-still-present" });
  });

  it("does not acknowledge replacement when the stable subject changed shape", () => {
    const replaceEdit = edit({
      selector: '[data-agent-native-node-id="subject"]',
      sourceId: "subject",
      insertedHtml:
        '<section data-agent-native-node-id="replacement">Replacement</section>',
      replaced: true,
      replacementSelector: '[data-agent-native-node-id="replacement"]',
      replacementSourceId: "replacement",
      subjectSignature: { tag: "div", text: "Original", classes: [] },
      replacementSignature: {
        tag: "section",
        text: "Replacement",
        classes: [],
      },
    });
    const html = `<!doctype html><body>
      <div data-agent-native-node-id="subject">Changed</div>
      <section data-agent-native-node-id="replacement">Replacement</section>
    </body>`;
    expect(verifyPendingStructureRuntime(html, replaceEdit)).toEqual({
      ok: false,
      failure: "subject-still-present",
    });
  });

  it("accepts a same-shaped replacement when its new identity is stable", () => {
    const sameShapeSignature = {
      tag: "section",
      text: "Same",
      classes: [],
    };
    const replaceEdit = edit({
      selector: '[data-agent-native-node-id="subject"]',
      sourceId: "subject",
      insertedHtml:
        '<section data-agent-native-node-id="replacement">Same</section>',
      replaced: true,
      replacementSelector: '[data-agent-native-node-id="replacement"]',
      replacementSourceId: "replacement",
      subjectSignature: sameShapeSignature,
      replacementSignature: sameShapeSignature,
    });
    const html = `<!doctype html><body>
      <section data-agent-native-node-id="replacement">Same</section>
    </body>`;
    expect(verifyPendingStructureRuntime(html, replaceEdit)).toEqual({
      ok: true,
    });
  });

  it("accepts an identity-less same-shaped replacement at a unique structural position", () => {
    const sameShapeSignature = {
      tag: "section",
      text: "Same",
      classes: [],
    };
    const replaceEdit = edit({
      selector: "main > section:nth-of-type(2)",
      sourceId: null,
      insertedHtml: "<section>Same</section>",
      replaced: true,
      replacementSelector: "main > section:nth-of-type(2)",
      replacementSourceId: null,
      subjectSignature: sameShapeSignature,
      replacementSignature: sameShapeSignature,
    });
    expect(
      verifyPendingStructureRuntime(
        `<!doctype html><body><main>
          <section>Same</section>
          <section>Same</section>
        </main></body>`,
        replaceEdit,
      ),
    ).toEqual({ ok: true });
  });

  it("fails closed when an identity-less replacement selector is ambiguous", () => {
    const sameShapeSignature = {
      tag: "section",
      text: "Same",
      classes: [],
    };
    const replaceEdit = edit({
      selector: '[data-agent-native-node-id="old-subject"]',
      sourceId: null,
      insertedHtml: "<section>Same</section>",
      replaced: true,
      replacementSelector: "section",
      replacementSourceId: null,
      subjectSignature: sameShapeSignature,
      replacementSignature: sameShapeSignature,
    });
    expect(
      verifyPendingStructureRuntime(
        `<!doctype html><body><main>
          <section>Same</section>
          <section>Same</section>
        </main></body>`,
        replaceEdit,
      ),
    ).toEqual({ ok: false, failure: "ambiguous-replacement" });
  });

  it("requires every affected screen relationship", () => {
    const html = `<!doctype html><body><section data-agent-native-node-id="anchor"><div data-agent-native-node-id="subject">Subject</div></section></body>`;
    expect(
      verifyPendingStructuresRuntime(
        { home: { html }, settings: { html: "<body></body>" } },
        [edit(), edit({ screenId: "settings" })],
      ),
    ).toEqual({ ok: false, failure: "missing-subject" });
  });

  it("drains each edit as soon as its screen proves the relationship", () => {
    const html = `<!doctype html><body><section data-agent-native-node-id="anchor"><div data-agent-native-node-id="subject">Subject</div></section></body>`;
    const first = edit({ screenId: "home" });
    const second = edit({ screenId: "settings" });
    expect(
      partitionPendingStructuresRuntime({ home: { html } }, [first, second]),
    ).toEqual({ verified: [first], remaining: [second] });
  });
});

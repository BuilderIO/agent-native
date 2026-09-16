import { describe, expect, it } from "vitest";

import type { PendingLiveStructureEdit } from "./pending-edits";
import {
  isPendingStructureDropNoOp,
  partitionPendingStructuresRuntime,
  runtimeStructureSnapshotSignature,
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

  const originalSignature = { tag: "p", text: "Original", classes: [] };
  const replacementSignature = {
    tag: "section",
    text: "Replacement",
    classes: [],
  };
  const replacementHtml =
    '<section data-agent-native-node-id="replacement">Replacement</section>';
  const replacementEdit = edit({
    replaced: true,
    selector: "main > p:nth-of-type(1)",
    subjectSignature: originalSignature,
    insertedHtml: replacementHtml,
    replacementSourceId: "replacement",
    replacementSelector: '[data-agent-native-node-id="replacement"]',
    replacementSignature,
  });

  it.each<{
    name: string;
    html: string;
    expectedHtml?: string;
    overrides?: Partial<PendingLiveStructureEdit>;
    failure?: string;
  }>([
    {
      name: "accepts a shape-changing replacement after the old identity disappears",
      html: replacementHtml,
    },
    {
      name: "ignores a stale old selector pointing at the replacement",
      html: replacementHtml,
      overrides: { selector: "main > section:nth-of-type(1)" },
    },
    {
      name: "ignores a stale old selector pointing at an unrelated sibling",
      html: "<div>Unrelated</div>" + replacementHtml,
      expectedHtml: "<div>Unrelated</div>" + replacementHtml,
      overrides: {
        sourceId: null,
        selector: "main > div:nth-of-type(1)",
      },
    },
    {
      name: "rejects a surviving old node that lost both identity and shape",
      html: "<div>Changed</div>" + replacementHtml,
      failure: "replacement-context-changed",
    },
    {
      name: "accepts the identical snapshot when Changed was a captured unrelated sibling",
      html: "<div>Changed</div>" + replacementHtml,
      expectedHtml: "<div>Changed</div>" + replacementHtml,
    },
    {
      name: "rejects a changed old node wrapping the valid replacement",
      html: "<div>Changed" + replacementHtml + "</div>",
      failure: "replacement-context-changed",
    },
    {
      name: "compares full replacement text beyond the node-signature prefix",
      html:
        '<section data-agent-native-node-id="replacement">' +
        "x".repeat(200) +
        "Wrong</section>",
      expectedHtml:
        '<section data-agent-native-node-id="replacement">' +
        "x".repeat(200) +
        "Expected</section>",
      overrides: {
        replacementSignature: {
          tag: "section",
          text: "x".repeat(120),
          classes: [],
        },
      },
      failure: "replacement-context-changed",
    },
    {
      name: "tolerates regenerated runtime identities and computed styles",
      html: '<section data-agent-native-node-id="hmr-replacement" style="color:red">Replacement</section>',
    },
    {
      name: "requires captured replacement evidence even when old identity and signature vanish",
      html: replacementHtml,
      overrides: { replacementSnapshotSignature: undefined },
      failure: "missing-replacement-evidence",
    },
    {
      name: "fails closed when a previously captured unrelated sibling disappears",
      html: replacementHtml,
      expectedHtml: "<div>Unrelated</div>" + replacementHtml,
      failure: "replacement-context-changed",
    },
    {
      name: "rejects a surviving old identity even after its shape changes",
      html:
        '<div data-agent-native-node-id="subject">Changed</div>' +
        replacementHtml,
      failure: "subject-still-present",
    },
    {
      name: "rejects an unchanged old subject whose identity was regenerated",
      html:
        '<p data-agent-native-node-id="new-subject">Original</p>' +
        replacementHtml,
      failure: "subject-still-present",
    },
    {
      name: "rejects ambiguous old identities even with a unique selector",
      html:
        '<p data-agent-native-node-id="subject">Original</p><div data-agent-native-node-id="subject">Changed</div>' +
        replacementHtml,
      failure: "ambiguous-subject",
    },
    {
      name: "rejects duplicate replacement identities despite a disambiguating selector",
      html:
        replacementHtml +
        '<div data-agent-native-node-id="replacement">Wrong</div>',
      overrides: {
        replacementSelector:
          'body > main > section[data-agent-native-node-id="replacement"]',
      },
      failure: "ambiguous-replacement",
    },
    {
      name: "rejects an absent replacement",
      html: "",
      failure: "missing-replacement",
    },
    {
      name: "rejects a replacement identity with the wrong shape",
      html: '<div data-agent-native-node-id="replacement">Wrong</div><section>Replacement</section>',
      failure: "missing-replacement",
    },
    {
      name: "accepts same-shaped content with distinct stable replacement identity",
      html: replacementHtml,
      overrides: { subjectSignature: replacementSignature },
    },
    {
      name: "rejects reuse of the old identity as a replacement",
      html: replacementHtml,
      overrides: {
        sourceId: "replacement",
        subjectSignature: replacementSignature,
      },
      failure: "subject-still-present",
    },
    {
      name: "accepts an identity-less shape change when the old selector shifts",
      html: replacementHtml,
      overrides: {
        sourceId: null,
        selector: "main > section:nth-of-type(1)",
        replacementSourceId: null,
      },
    },
    {
      name: "accepts an identity-less shape change through unique signature fallback",
      html: "<section>Replacement</section>",
      overrides: { sourceId: null, replacementSourceId: null },
    },
    {
      name: "rejects unchanged identity-less content at the same selector",
      html: "<section>Replacement</section>",
      overrides: {
        sourceId: null,
        selector: "main > section:nth-of-type(1)",
        subjectSignature: replacementSignature,
        replacementSourceId: null,
        replacementSelector: "main > section:nth-of-type(1)",
      },
      failure: "subject-still-present",
    },
    {
      name: "rejects unchanged identity-less content reached by signature fallback",
      html: "<section>Replacement</section>",
      overrides: {
        sourceId: null,
        selector: "main > section:nth-of-type(2)",
        subjectSignature: replacementSignature,
        replacementSourceId: null,
        replacementSelector: "main > section:nth-of-type(3)",
      },
      failure: "subject-still-present",
    },
    {
      name: "accepts a unique selector-only same-shaped replacement when old source identity is absent",
      html: "<section>Replacement</section>",
      overrides: {
        selector: "main > section:nth-of-type(1)",
        subjectSignature: replacementSignature,
        replacementSourceId: null,
        replacementSelector: "main > section:nth-of-type(1)",
      },
    },
    {
      name: "requires evidence for a unique selector-only same-shaped replacement",
      html: "<section>Replacement</section>",
      overrides: {
        subjectSignature: replacementSignature,
        replacementSourceId: null,
        replacementSelector: "main > section:nth-of-type(1)",
        replacementSnapshotSignature: undefined,
      },
      failure: "missing-replacement-evidence",
    },
    {
      name: "accepts a distinct stable replacement after the identity-less old selector disappears",
      html: replacementHtml,
      overrides: { sourceId: null, subjectSignature: replacementSignature },
    },
    {
      name: "rejects an unchanged old selector even when it matches the replacement identity",
      html: replacementHtml,
      overrides: {
        sourceId: null,
        selector: '[data-agent-native-node-id="replacement"]',
        subjectSignature: replacementSignature,
      },
      failure: "subject-still-present",
    },
    {
      name: "rejects an ambiguous replacement selector over a unique signature",
      html: '<div data-testid="replacement">Wrong</div><section data-testid="replacement">Replacement</section>',
      overrides: {
        replacementSourceId: null,
        replacementSelector: '[data-testid="replacement"]',
      },
      failure: "ambiguous-replacement",
    },
    {
      name: "rejects a wrong-shape replacement selector over a matching sibling",
      html: "<div>Wrong</div><section>Replacement</section>",
      overrides: {
        replacementSourceId: null,
        replacementSelector: "main > div:nth-of-type(1)",
      },
      failure: "missing-replacement",
    },
    {
      name: "rejects ambiguous old signatures",
      html: "<p>Original</p><p>Original</p>" + replacementHtml,
      failure: "ambiguous-subject",
    },
  ])(
    "$name",
    ({ html, expectedHtml = replacementHtml, overrides, failure }) => {
      expect(
        verifyPendingStructureRuntime(
          `<!doctype html><body><main>${html}</main></body>`,
          {
            ...replacementEdit,
            replacementSnapshotSignature: runtimeStructureSnapshotSignature(
              `<!doctype html><body><main>${expectedHtml}</main></body>`,
            ),
            ...overrides,
          },
        ),
      ).toEqual(failure ? { ok: false, failure } : { ok: true });
    },
  );

  it("keeps an identity-less removal fail-closed when its selector resolves", () => {
    expect(
      verifyPendingStructureRuntime(
        "<!doctype html><body><main><div>Still here</div></main></body>",
        edit({
          sourceId: null,
          selector: "main > div:nth-of-type(1)",
          removed: true,
          subjectSignature: { tag: "div", text: "Original", classes: [] },
        }),
      ),
    ).toEqual({ ok: false, failure: "subject-still-present" });
  });

  it.each([
    ["a", "href", "/expected", "/wrong"],
    ["img", "src", "/expected.png", "/wrong.png"],
    ["button", "aria-label", "Save", "Delete"],
    ["button", "aria-expanded", "true", "false"],
    ["div", "data-state", "open", "closed"],
    ["div", "data-agent-native-state", "open", "closed"],
    ["div", "data-source-state", "open", "closed"],
  ])(
    "rejects changed %s %s despite identical structure",
    (tag, name, before, after) => {
      const snapshot = (value: string) =>
        `<body><main>${replacementHtml}<${tag} ${name}="${value}"></${tag}></main></body>`;
      expect(
        verifyPendingStructureRuntime(snapshot(after), {
          ...replacementEdit,
          replacementSnapshotSignature: runtimeStructureSnapshotSignature(
            snapshot(before),
          ),
        }),
      ).toEqual({ ok: false, failure: "replacement-context-changed" });
    },
  );

  it("normalizes attribute and class order while preserving attribute namespaces", () => {
    const before =
      '<body><svg class="two one"><use href="#plain" xlink:href="#linked" aria-label="Icon" /></svg></body>';
    const reordered =
      '<body><svg class="one two"><use aria-label="Icon" xlink:href="#linked" href="#plain" /></svg></body>';
    expect(runtimeStructureSnapshotSignature(reordered)).toBe(
      runtimeStructureSnapshotSignature(before),
    );
    expect(
      runtimeStructureSnapshotSignature(
        before.replace('xlink:href="#linked"', 'xlink:href="#wrong"'),
      ),
    ).not.toBe(runtimeStructureSnapshotSignature(before));
    expect(
      runtimeStructureSnapshotSignature(
        '<body><svg><use href="#icon" /></svg></body>',
      ),
    ).not.toBe(
      runtimeStructureSnapshotSignature(
        '<body><svg><use xlink:href="#icon" /></svg></body>',
      ),
    );
  });

  it("ignores bridge runtime-only attributes but preserves authored data", () => {
    const metadata = [
      "data-agent-native-node-id",
      "data-agent-native-node-rewrite-proposal",
      "data-agent-native-group-runtime-state",
      "data-agent-native-runtime-hidden",
      "data-agent-native-runtime-locked",
      "data-agent-native-previous-display",
      "data-agent-native-text-editing",
      "data-an-pending-node-id",
      "data-an-state-preview",
      "data-an-state-preview-key",
      "data-an-vector-logical-width",
      "data-an-vector-stroke-defs",
      "data-an-vector-stroke-geometry",
      "data-an-vector-stroke-original-overflow",
      "data-an-vector-stroke-original-overflow-priority",
      "data-an-vector-stroke-overlay",
      "data-an-vector-stroke-position",
      "data-an-runtime-layer-snapshot",
      "data-source-framework",
      "data-source-file",
      "data-source-line",
      "data-source-method",
      "data-source-column",
      "data-component-name",
      "data-source-owner-file",
      "data-source-owner-line",
      "data-source-owner-column",
      "data-source-owner-component",
      "data-source-owner-method",
      "data-source-owner-key",
      "data-source-unavailable",
      "style",
    ]
      .map((name) => `${name}="runtime"`)
      .join(" ");
    expect(
      runtimeStructureSnapshotSignature(
        `<body ${metadata}><section ${metadata}>Replacement</section></body>`,
      ),
    ).toBe(
      runtimeStructureSnapshotSignature(
        "<body><section>Replacement</section></body>",
      ),
    );
    expect(
      runtimeStructureSnapshotSignature(
        '<body><section data-agent-native-hidden="true">Replacement</section></body>',
      ),
    ).not.toBe(
      runtimeStructureSnapshotSignature(
        "<body><section>Replacement</section></body>",
      ),
    );
  });

  it("verifies multiple replacements against the latest captured screen while retaining identity checks", () => {
    const secondHtml =
      '<article data-agent-native-node-id="second">Second</article>';
    const html = `<!doctype html><body><main>${replacementHtml}${secondHtml}</main></body>`;
    const first = {
      ...replacementEdit,
      replacementSnapshotSignature: runtimeStructureSnapshotSignature(
        `<!doctype html><body><main>${replacementHtml}<p data-agent-native-node-id="old-second">Old second</p></main></body>`,
      ),
    };
    const second = {
      ...replacementEdit,
      selector: '[data-agent-native-node-id="old-second"]',
      sourceId: "old-second",
      subjectSignature: { tag: "p", text: "Old second", classes: [] },
      replacementSourceId: "second",
      replacementSignature: { tag: "article", text: "Second", classes: [] },
      replacementSnapshotSignature: runtimeStructureSnapshotSignature(html),
    };
    const snapshots = { home: { html } };
    const settling = {
      home: {
        html: html.replace('node-id="replacement"', 'node-id="subject"'),
      },
    };
    const pending = partitionPendingStructuresRuntime(settling, [
      first,
      second,
    ]);
    expect(pending).toEqual({ verified: [], remaining: [first, second] });
    expect(
      partitionPendingStructuresRuntime(snapshots, pending.remaining),
    ).toEqual({ verified: [first, second], remaining: [] });
    expect(verifyPendingStructuresRuntime(snapshots, [first, second])).toEqual({
      ok: true,
    });
    expect(
      partitionPendingStructuresRuntime(snapshots, [first, second]),
    ).toEqual({ verified: [first, second], remaining: [] });
    const lingering = {
      home: {
        html: html.replace(
          "</main>",
          '<div data-agent-native-node-id="subject">Changed</div></main>',
        ),
      },
    };
    expect(
      partitionPendingStructuresRuntime(lingering, [first, second]),
    ).toEqual({ verified: [], remaining: [first, second] });
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

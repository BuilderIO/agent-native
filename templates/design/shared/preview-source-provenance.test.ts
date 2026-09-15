import { describe, expect, it } from "vitest";

import {
  createSourceDocumentProvenance,
  readSourceNodeProvenance,
  resolveSourceNodeProvenance,
} from "./preview-source-provenance";
import { sourceContentHash } from "./source-workspace";

describe("preview source provenance", () => {
  it("hashes exact source bytes and counts every bridge source-ID alias", () => {
    const content = `<html><body>
      <div data-agent-native-node-id="native">native</div>
      <div data-code-layer-id="code">code</div>
      <div data-layer-id="layer">layer</div>
      <div data-builder-id="builder">builder</div>
      <div data-loc="loc">loc</div>
      <div id="authored">id</div>
      <div data-agent-native-node-id="same" id="same">same aliases on one node</div>
      <div data-code-layer-id="same">same on another node</div>
      <div id="duplicate">duplicate one</div>
      <div data-loc="duplicate">duplicate two through another alias</div>
    </body></html>`;

    expect(createSourceDocumentProvenance(content)).toEqual({
      versionHash: sourceContentHash(content),
      uniqueNodeIds: ["authored", "builder", "code", "layer", "loc", "native"],
    });
  });

  it("counts aliases across template content and rendered elements", () => {
    const content = `<html><body>
      <template>
        <div data-agent-native-node-id="template-only" data-loc="shared"></div>
      </template>
      <section data-builder-id="shared"></section>
    </body></html>`;

    expect(createSourceDocumentProvenance(content).uniqueNodeIds).toEqual([
      "template-only",
    ]);
  });

  it.each([
    '<script>document.body.append("runtime")</script>',
    '<script type="text/javascript">run()</script>',
    '<script type="module">run()</script>',
    '<script src="runtime.js"></script>',
  ])("withholds positional proof for executable markup %s", (script) => {
    const content = `<html><body><button data-agent-native-node-id="stable">selected</button>${script}</body></html>`;
    const proof = createSourceDocumentProvenance(content);
    expect(proof.versionHash).toBe("");
    expect(proof.uniqueNodeIds).toContain("stable");
    expect(
      resolveSourceNodeProvenance(content, {
        versionHash: sourceContentHash(content),
      }),
    ).toBeUndefined();
    expect(
      resolveSourceNodeProvenance(content, { uniqueNodeId: "stable" }),
    ).toEqual({ uniqueNodeId: "stable", allowSelector: false });
  });

  it.each([
    "application/json",
    "application/ld+json",
    "text/template",
    "importmap",
  ])("retains static idless proof for inert %s script data", (type) => {
    const content = `<html><body><button>selected</button><script type="${type}">{}</script></body></html>`;
    expect(createSourceDocumentProvenance(content).versionHash).toBe(
      sourceContentHash(content),
    );
    expect(
      resolveSourceNodeProvenance(content, {
        versionHash: sourceContentHash(content),
      }),
    ).toEqual({ allowSelector: true });
  });

  it("reads partial provenance and rejects malformed payloads", () => {
    expect(readSourceNodeProvenance(null)).toBeUndefined();
    expect(readSourceNodeProvenance([])).toBeUndefined();
    expect(
      readSourceNodeProvenance({ versionHash: 42, uniqueNodeId: "" }),
    ).toBeUndefined();
    expect(readSourceNodeProvenance({ uniqueNodeId: "node-1" })).toEqual({
      uniqueNodeId: "node-1",
    });
    expect(
      readSourceNodeProvenance({
        versionHash: "3:abc",
        uniqueNodeId: "node-1",
      }),
    ).toEqual({ versionHash: "3:abc", uniqueNodeId: "node-1" });
  });

  it("allows selectors only for the exact document version and IDs across unrelated edits", () => {
    const rendered = `<html><body><button class="item">selected</button></body></html>`;
    const currentWithSibling = `<html><body><button class="item">new</button><button class="item">selected</button></body></html>`;

    expect(
      resolveSourceNodeProvenance(currentWithSibling, {
        versionHash: sourceContentHash(rendered),
      }),
    ).toBeUndefined();
    expect(
      resolveSourceNodeProvenance(rendered, {
        versionHash: sourceContentHash(rendered),
      }),
    ).toEqual({ allowSelector: true });

    const identified = `<html><body><button data-agent-native-node-id="selected">selected</button></body></html>`;
    const identifiedWithSibling = `<html><body><button>new</button><button data-agent-native-node-id="selected">selected</button></body></html>`;
    expect(
      resolveSourceNodeProvenance(identifiedWithSibling, {
        uniqueNodeId: "selected",
      }),
    ).toEqual({ uniqueNodeId: "selected", allowSelector: false });
    expect(
      resolveSourceNodeProvenance(identifiedWithSibling, {
        versionHash: sourceContentHash(identified),
        uniqueNodeId: "selected",
      }),
    ).toEqual({ uniqueNodeId: "selected", allowSelector: false });
  });
});

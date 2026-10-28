import {
  createSourceDocumentProvenance,
  sourceDocumentProvenanceFromTree,
} from "@shared/preview-source-provenance";
import { parse } from "parse5";
import { expect, it } from "vitest";

import {
  runtimeSrcSpans,
  runtimeSrcSpansFromTree,
} from "../design-canvas/runtime-src-spans";

const documents = [
  `<!doctype html><html><head>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  </head><body>
    <div data-agent-native-node-id="a" id="a"><p data-agent-native-node-id="b">x</p></div>
    <p data-agent-native-node-id="b">duplicate</p>
    <template><span data-agent-native-node-id="c"></span></template>
    <svg><rect data-layer-id="d"/></svg>
  </body></html>`,
  `<html><body><script type="module">let a = 1;</script><div id="solo"></div></body></html>`,
];

it("derives provenance and runtime spans from one location-aware parse exactly as two parses do", () => {
  for (const content of documents) {
    const root = parse(content, { sourceCodeLocationInfo: true });
    expect(sourceDocumentProvenanceFromTree(root, content)).toEqual(
      createSourceDocumentProvenance(content),
    );
    expect(runtimeSrcSpansFromTree(root)).toEqual(runtimeSrcSpans(content));
  }
});

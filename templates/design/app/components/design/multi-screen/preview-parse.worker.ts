import { parse } from "parse5";

import {
  sourceDocumentProvenanceFromTree,
  type SourceDocumentProvenance,
} from "../../../../shared/preview-source-provenance";
import {
  runtimeSrcSpansFromTree,
  type SrcSpan,
} from "../design-canvas/runtime-src-spans";
import { documentFileColorCounts } from "../edit-panel/document-colors";

export type PreviewParseRequest =
  | { kind: "preview"; id: number; content: string }
  | { kind: "colors"; id: number; fileId: string; content: string };

export type PreviewParseResponse =
  | {
      kind: "preview";
      id: number;
      provenance: SourceDocumentProvenance;
      runtimeSpans: SrcSpan[];
    }
  | { kind: "colors"; id: number; counts: [string, number][] };

self.onmessage = (event: MessageEvent<PreviewParseRequest>) => {
  const request = event.data;
  if (request.kind === "colors") {
    const counts = documentFileColorCounts(
      { id: request.fileId, content: request.content },
      new Map(),
    );
    const response: PreviewParseResponse = {
      kind: "colors",
      id: request.id,
      counts: [...counts],
    };
    self.postMessage(response);
    return;
  }
  // One parse serves both: source locations add fields but never change the tree.
  const root = parse(request.content, { sourceCodeLocationInfo: true });
  const response: PreviewParseResponse = {
    kind: "preview",
    id: request.id,
    provenance: sourceDocumentProvenanceFromTree(root, request.content),
    runtimeSpans: runtimeSrcSpansFromTree(root),
  };
  self.postMessage(response);
};

import { injectDocumentMarkup } from "@agent-native/core/shared";
import {
  createSourceDocumentProvenance,
  type SourceDocumentProvenance,
} from "@shared/preview-source-provenance";

import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

export const LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT = `
<script data-agent-native-hit-test-bridge>
${hitTestBridgeScript}
</script>
`;

export function sourceProvenanceBootstrap(
  provenance: SourceDocumentProvenance,
): string {
  const serialized = JSON.stringify(provenance).replace(/</g, "\\u003c");
  return `<script data-agent-native-edit-overlay data-agent-native-source-provenance>window.__agentNativeSourceProvenance=${serialized};</script>`;
}

export function appendHitTestResponder(
  html: string,
  authoredContent: string = html,
): string {
  return injectDocumentMarkup(
    html,
    sourceProvenanceBootstrap(createSourceDocumentProvenance(authoredContent)) +
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT,
  );
}

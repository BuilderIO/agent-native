import { injectDocumentMarkup } from "@agent-native/core/shared";

import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

export const LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT = `
<script data-agent-native-hit-test-bridge>
${hitTestBridgeScript}
</script>
`;

export function appendHitTestResponder(html: string): string {
  return injectDocumentMarkup(html, LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT);
}

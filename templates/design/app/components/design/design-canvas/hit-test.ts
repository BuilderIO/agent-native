import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

export const LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT = `
<script data-agent-native-hit-test-bridge>
${hitTestBridgeScript}
</script>
`;

export function appendHitTestResponder(html: string): string {
  if (html.includes("</body>")) {
    return html.replace(
      "</body>", // i18n-ignore generated iframe HTML marker
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</body>", // i18n-ignore generated iframe HTML injection
    );
  }
  if (html.includes("</html>")) {
    return html.replace(
      "</html>", // i18n-ignore generated iframe HTML marker
      LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</html>", // i18n-ignore generated iframe HTML injection
    );
  }
  return html + LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT;
}

import { hitTestBridgeScript } from "../../../../.generated/bridge/hit-test.generated";

export const LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT = `
<script data-agent-native-hit-test-bridge>
${hitTestBridgeScript}
</script>
`;

export function appendHitTestResponder(html: string): string {
  // Replacer must be a function, not a string: the hit-test bridge's compiled
  // source can contain literal "$&" (e.g. editor-chrome's escapeIdent helper
  // runs through the same html string in the caller's pipeline). A string
  // replacement arg makes String.replace treat "$&" as the special "insert
  // the matched text" pattern, splicing a stray "</body>" mid-script and
  // truncating its <script> tag early. A function replacer inserts its
  // return value verbatim, with no $-pattern substitution.
  if (html.includes("</body>")) {
    return html.replace(
      "</body>", // i18n-ignore generated iframe HTML marker
      () => LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</body>", // i18n-ignore generated iframe HTML injection
    );
  }
  if (html.includes("</html>")) {
    return html.replace(
      "</html>", // i18n-ignore generated iframe HTML marker
      () => LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT + "</html>", // i18n-ignore generated iframe HTML injection
    );
  }
  return html + LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT;
}

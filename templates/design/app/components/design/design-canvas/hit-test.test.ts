import { describe, expect, it } from "vitest";

import {
  LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT,
  appendHitTestResponder,
} from "./hit-test";

describe("appendHitTestResponder", () => {
  it("injects the responder script before </body>", () => {
    const out = appendHitTestResponder("<html><body><h1>hi</h1></body></html>");
    expect(out).toContain("data-agent-native-hit-test-bridge");
    expect(out.indexOf("data-agent-native-hit-test-bridge")).toBeLessThan(
      out.indexOf("</body>"),
    );
  });

  it("falls back to </html> then append when there is no </body>", () => {
    expect(appendHitTestResponder("<html>x</html>")).toContain(
      "data-agent-native-hit-test-bridge",
    );
    expect(appendHitTestResponder("plain")).toContain(
      "data-agent-native-hit-test-bridge",
    );
  });

  // Regression: html already carries earlier bridge scripts (e.g. editor-chrome's
  // compiled escapeIdent helper contains a literal "$&") by the time this runs.
  // A string second argument to String.replace treats "$&", "$'", "$`" as
  // special substitution patterns instead of literal text, splicing the
  // matched "</body>" into the middle of that prior script and truncating its
  // <script> tag early. The responder must insert its own text verbatim.
  it("does not treat $-patterns in preceding script content as replacement directives", () => {
    const priorScript = '<script>var re = "\\$&-$\'-$`";</script>';
    const out = appendHitTestResponder(
      `<html><body>${priorScript}</body></html>`,
    );
    expect(out).toContain(priorScript);
    expect(out.match(/<\/body>/g)?.length).toBe(1);
  });

  it("exports a non-empty compiled bridge script", () => {
    expect(LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT).toContain(
      "data-agent-native-hit-test-bridge",
    );
  });
});

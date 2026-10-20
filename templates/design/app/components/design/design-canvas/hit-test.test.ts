import { createSourceDocumentProvenance } from "@shared/preview-source-provenance";
import { describe, expect, it } from "vitest";

import {
  LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT,
  appendHitTestResponder,
  sourceProvenanceBootstrap,
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

  it("does not treat $-patterns in preceding script content as replacement directives", () => {
    const priorScript = '<script>var re = "\\$&-$\'-$`";</script>';
    const out = appendHitTestResponder(
      `<html><body>${priorScript}</body></html>`,
    );
    expect(out).toContain(priorScript);
    expect(out.match(/<\/body>/g)?.length).toBe(1);
  });

  it("binds the responder to authored bytes before preview wrappers", () => {
    const authored = '<html><body><main id="source">hello</main></body></html>';
    const rendered = authored.replace(
      "<main",
      "<aside data-preview-wrapper></aside><main",
    );
    const proof = createSourceDocumentProvenance(authored);
    const out = appendHitTestResponder(rendered, authored);
    expect(out).toContain(sourceProvenanceBootstrap(proof));
    expect(out.indexOf("__agentNativeSourceProvenance=")).toBeLessThan(
      out.indexOf("data-agent-native-hit-test-bridge"),
    );
    expect(proof.versionHash).not.toBe(
      createSourceDocumentProvenance(rendered).versionHash,
    );
  });

  it("escapes authored IDs that could terminate the bootstrap script", () => {
    const out = sourceProvenanceBootstrap({
      versionHash: "v",
      uniqueNodeIds: ["</script><script>bad()</script>"],
    });
    expect(out.match(/<script/g)).toHaveLength(1);
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    expect(out).toContain("\\u003c/script>");
  });

  it("exports a non-empty compiled bridge script", () => {
    expect(LIGHTWEIGHT_HIT_TEST_BRIDGE_SCRIPT).toContain(
      "data-agent-native-hit-test-bridge",
    );
  });
});

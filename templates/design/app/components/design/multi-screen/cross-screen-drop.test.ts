// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  captureCrossScreenSourceHtmlSnapshot,
  validateCrossScreenSourceHtmlSnapshot,
} from "./cross-screen-drop";

describe("cross-screen source HTML snapshots", () => {
  it("captures the complete board root subtree from the host-verified document", () => {
    const sourceDocument = document.implementation.createHTMLDocument();
    sourceDocument.body.innerHTML = `
      <div data-agent-native-node-id="root">
        <div data-agent-native-node-id="child">
          <span data-agent-native-node-id="grandchild">Nested</span>
        </div>
      </div>
    `;

    const snapshot = captureCrossScreenSourceHtmlSnapshot(
      sourceDocument,
      "root",
    );

    expect(snapshot).toContain('data-agent-native-node-id="root"');
    expect(snapshot).toContain('data-agent-native-node-id="child"');
    expect(snapshot).toContain('data-agent-native-node-id="grandchild"');
  });

  it("accepts exactly one matching root and rejects mismatches or siblings", () => {
    const valid =
      '<div data-agent-native-node-id="root"><div data-agent-native-node-id="child"></div></div>';

    expect(validateCrossScreenSourceHtmlSnapshot(valid, "root")).toBe(valid);
    expect(
      validateCrossScreenSourceHtmlSnapshot(valid, "different-root"),
    ).toBeUndefined();
    expect(
      validateCrossScreenSourceHtmlSnapshot(
        `${valid}<div data-agent-native-node-id="sibling"></div>`,
        "root",
      ),
    ).toBeUndefined();
  });
});

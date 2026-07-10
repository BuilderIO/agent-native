import { describe, expect, it } from "vitest";

import {
  assertLockedLayersPreserved,
  countLockedLayers,
  countLockedLayersAcrossFiles,
} from "./locked-layers.js";

const source = `<!doctype html><html><body>
  <div data-agent-native-node-id="bg" data-agent-native-locked="true"><span>Fixed</span></div>
  <main data-agent-native-node-id="content">Editable</main>
</body></html>`;

describe("locked layers", () => {
  it("allows edits outside a locked subtree", () => {
    const next = source.replace(">Editable<", ">Changed<");
    expect(() => assertLockedLayersPreserved(source, next)).not.toThrow();
    expect(countLockedLayers(source)).toBe(1);
  });

  it("rejects changing or deleting a locked subtree", () => {
    expect(() =>
      assertLockedLayersPreserved(source, source.replace("Fixed", "Changed")),
    ).toThrow(/locked layer/i);
    expect(() =>
      assertLockedLayersPreserved(
        source,
        source.replace(
          '<div data-agent-native-node-id="bg" data-agent-native-locked="true"><span>Fixed</span></div>',
          "",
        ),
      ),
    ).toThrow(/locked layer/i);
  });

  it("counts only durable DOM locks across files", () => {
    expect(
      countLockedLayersAcrossFiles([
        { content: source },
        {
          content:
            '<section data-agent-native-node-id="second" data-agent-native-locked="true">Fixed</section>',
        },
        { content: "screen-id-only" },
      ]),
    ).toBe(2);
  });
});

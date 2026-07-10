import { describe, expect, it } from "vitest";

import type { PendingLiveStructureEdit } from "./pending-edits";
import {
  verifyPendingStructureRuntime,
  verifyPendingStructuresRuntime,
} from "./pending-structure-verification";

function edit(
  overrides: Partial<PendingLiveStructureEdit> = {},
): PendingLiveStructureEdit {
  return {
    kind: "structure",
    screenId: "home",
    filename: "home",
    screenName: "Home",
    selector: "#subject",
    sourceId: "subject",
    anchorSelector: "#anchor",
    anchorSourceId: "anchor",
    placement: "inside",
    dropMode: "flow-insert",
    updatedAt: 1,
    ...overrides,
  };
}

describe("verifyPendingStructureRuntime", () => {
  it("proves inside flow insertion and rejects an absolute remount", () => {
    const flow = `<!doctype html><body>
      <section id="anchor" data-agent-native-node-id="anchor" style="display:flex">
        <div id="subject" data-agent-native-node-id="subject" style="position:static">Subject</div>
      </section>
    </body>`;
    expect(verifyPendingStructureRuntime(flow, edit())).toEqual({ ok: true });

    const absolute = flow.replace("position:static", "position:absolute");
    expect(verifyPendingStructureRuntime(absolute, edit())).toEqual({
      ok: false,
      failure: "wrong-drop-mode",
    });
  });

  it("proves absolute-container nesting", () => {
    const html = `<!doctype html><body>
      <section id="anchor" data-agent-native-node-id="anchor" style="position:relative">
        <div id="subject" data-agent-native-node-id="subject" style="position:absolute;left:40px;top:20px">Subject</div>
      </section>
    </body>`;
    expect(
      verifyPendingStructureRuntime(
        html,
        edit({ dropMode: "absolute-container" }),
      ),
    ).toEqual({ ok: true });
  });

  it("requires exact before/between/after order", () => {
    const html = `<!doctype html><body><main data-agent-native-node-id="parent">
      <div data-agent-native-node-id="first">First</div>
      <div id="subject" data-agent-native-node-id="subject">Subject</div>
      <div id="anchor" data-agent-native-node-id="anchor">Anchor</div>
      <div data-agent-native-node-id="last">Last</div>
    </main></body>`;
    expect(
      verifyPendingStructureRuntime(html, edit({ placement: "before" })),
    ).toEqual({ ok: true });
    expect(
      verifyPendingStructureRuntime(html, edit({ placement: "after" })),
    ).toEqual({ ok: false, failure: "wrong-order" });
  });

  it("requires every affected screen relationship", () => {
    const html = `<!doctype html><body><section data-agent-native-node-id="anchor"><div data-agent-native-node-id="subject">Subject</div></section></body>`;
    expect(
      verifyPendingStructuresRuntime(
        { home: { html }, settings: { html: "<body></body>" } },
        [edit(), edit({ screenId: "settings" })],
      ),
    ).toEqual({ ok: false, failure: "missing-subject" });
  });
});

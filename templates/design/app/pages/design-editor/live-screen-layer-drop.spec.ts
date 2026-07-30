// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { prepareLiveScreenLayerDrop } from "./live-screen-layer-drop";

const LIVE_URL = "http://localhost:8210/dashboard";
const GROUP_DOCUMENT = `<!doctype html><html><body>
  <section data-agent-native-node-id="group">
    <article data-agent-native-node-id="card">
      <strong data-agent-native-node-id="label">Nested label</strong>
    </article>
  </section>
</body></html>`;

describe("prepareLiveScreenLayerDrop", () => {
  it("serializes the complete nested subtree without changing the live URL", () => {
    const result = prepareLiveScreenLayerDrop({
      sourceContent: GROUP_DOCUMENT,
      destinationContent: LIVE_URL,
      nodeId: "group",
    });

    expect(result.status).toBe("applied");
    if (result.status !== "applied") throw new Error("unreachable");
    expect(result.destinationContent).toBe(LIVE_URL);
    expect(result.html).toContain('data-agent-native-node-id="group"');
    expect(result.html).toContain('data-agent-native-node-id="card"');
    expect(result.html).toContain('data-agent-native-node-id="label"');
    expect(result.html).toContain("Nested label");
    expect(result.html).not.toContain("<!doctype");
    expect(result.html).not.toContain("<body");
  });

  it("fails honestly when the source is another live route", () => {
    expect(
      prepareLiveScreenLayerDrop({
        sourceContent: "http://localhost:8210/source",
        destinationContent: LIVE_URL,
        nodeId: "group",
      }),
    ).toEqual({ status: "unsupported", reason: "source-is-live" });
  });

  it("fails honestly when the subtree cannot be resolved", () => {
    expect(
      prepareLiveScreenLayerDrop({
        sourceContent: GROUP_DOCUMENT,
        destinationContent: LIVE_URL,
        nodeId: "missing",
      }),
    ).toEqual({ status: "unsupported", reason: "node-unresolved" });
  });
});

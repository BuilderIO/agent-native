import { describe, expect, it, vi } from "vitest";

import MultiTabSource from "./MultiTabAssistantChat.tsx?raw";

/**
 * The tab counter and the host callback share one prop name, and the explicit
 * handler is written after `{...props}` — so the spread cannot deliver it.
 */
describe("MultiTabAssistantChat message count", () => {
  it("forwards the host callback instead of only counting tabs", () => {
    const handler = MultiTabSource.slice(
      MultiTabSource.indexOf("onMessageCountChange={(count) => {"),
      MultiTabSource.indexOf("onSaveThread={handleSaveThread}"),
    );
    expect(handler).toContain("setMessageCounts(");
    expect(handler).toContain("props.onMessageCountChange?.(count)");
  });

  it("keeps the explicit handler after the spread it must override", () => {
    const spreadAt = MultiTabSource.indexOf(
      "<AssistantChat\n                  {...props}",
    );
    const handlerAt = MultiTabSource.indexOf(
      "onMessageCountChange={(count) => {",
    );
    expect(spreadAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeGreaterThan(spreadAt);
  });
});

void vi;

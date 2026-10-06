import { describe, expect, it } from "vitest";

import {
  createEditorSaveOperationSource,
  shouldCheckpointAgentContent,
} from "./editor-session";

describe("createEditorSaveOperationSource", () => {
  it("changes across editor remounts while retaining the browser-tab prefix", () => {
    const firstMount = createEditorSaveOperationSource("tab-a", "editor-1");
    const secondMount = createEditorSaveOperationSource("tab-a", "editor-2");

    expect(firstMount).toBe("tab-a:save:editor-1");
    expect(secondMount).toBe("tab-a:save:editor-2");
    expect(secondMount).not.toBe(firstMount);
  });
});

describe("shouldCheckpointAgentContent", () => {
  it("checkpoints a genuine agent-driven content change", () => {
    expect(
      shouldCheckpointAgentContent({
        agentActive: true,
        isLocalEdit: false,
        previousContent: "<html>before</html>",
        nextContent: "<html>after</html>",
      }),
    ).toBe(true);
  });

  it("does not checkpoint when the agent is not active", () => {
    expect(
      shouldCheckpointAgentContent({
        agentActive: false,
        isLocalEdit: false,
        previousContent: "<html>before</html>",
        nextContent: "<html>after</html>",
      }),
    ).toBe(false);
  });

  it("does not checkpoint a local edit (this tab's own change echoing back)", () => {
    expect(
      shouldCheckpointAgentContent({
        agentActive: true,
        isLocalEdit: true,
        previousContent: "<html>before</html>",
        nextContent: "<html>after</html>",
      }),
    ).toBe(false);
  });

  it("does not checkpoint with no prior baseline (fresh file load, nothing to restore)", () => {
    expect(
      shouldCheckpointAgentContent({
        agentActive: true,
        isLocalEdit: false,
        previousContent: undefined,
        nextContent: "<html>after</html>",
      }),
    ).toBe(false);
    expect(
      shouldCheckpointAgentContent({
        agentActive: true,
        isLocalEdit: false,
        previousContent: null,
        nextContent: "<html>after</html>",
      }),
    ).toBe(false);
  });

  it("does not checkpoint a same-content no-op (self-echo)", () => {
    expect(
      shouldCheckpointAgentContent({
        agentActive: true,
        isLocalEdit: false,
        previousContent: "<html>same</html>",
        nextContent: "<html>same</html>",
      }),
    ).toBe(false);
  });
});

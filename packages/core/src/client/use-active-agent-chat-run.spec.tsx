// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearActiveRun,
  setActiveRun,
  updateActiveRunSeq,
} from "./active-run-state.js";
import { useActiveAgentChatRunId } from "./use-active-agent-chat-run.js";

describe("useActiveAgentChatRunId", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearActiveRun();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearActiveRun();
  });

  it("returns the active run only for its matching thread", async () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 0 });

    function Probe() {
      return <output>{useActiveAgentChatRunId("thread-1") ?? "none"}</output>;
    }

    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe("run-1");

    await act(async () => {
      setActiveRun({ threadId: "thread-2", runId: "run-2", lastSeq: 0 });
    });
    expect(container.textContent).toBe("none");
  });

  it("clears the run ID when the active run ends", async () => {
    function Probe() {
      return <output>{useActiveAgentChatRunId("thread-1") ?? "none"}</output>;
    }

    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe("none");

    await act(async () => {
      setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 0 });
    });
    expect(container.textContent).toBe("run-1");

    await act(async () => clearActiveRun());
    expect(container.textContent).toBe("none");
  });

  it("does not rerender when only the active run cursor changes", async () => {
    setActiveRun({ threadId: "thread-1", runId: "run-1", lastSeq: 0 });
    let renders = 0;

    function Probe() {
      renders += 1;
      return <output>{useActiveAgentChatRunId("thread-1") ?? "none"}</output>;
    }

    await act(async () => root.render(<Probe />));
    const initialRenders = renders;

    await act(async () => updateActiveRunSeq("thread-1", "run-1", 1));

    expect(container.textContent).toBe("run-1");
    expect(renders).toBe(initialRenders);
  });
});

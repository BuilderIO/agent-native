// @vitest-environment happy-dom

import { normalizeAgentTeamProgressResult } from "@agent-native/core/action-ui";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../../../i18n.js";
import { AgentTeamProgressWidget } from "./AgentTeamProgressWidget.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

const tasks = [
  {
    taskId: "task-1",
    threadId: "thread-1",
    description: "Compare signups",
    status: "completed",
  },
  {
    taskId: "task-2",
    threadId: "thread-2",
    description: "Find launch feedback",
    status: "running",
    currentStep: "Reading recent mail",
  },
  {
    taskId: "task-3",
    threadId: "thread-3",
    description: "Draft Monday update",
    status: "queued",
  },
];

describe("core.agent-team-progress", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("rejects empty, malformed, or oversized progress results", () => {
    expect(normalizeAgentTeamProgressResult("No background tasks.")).toBeNull();
    expect(normalizeAgentTeamProgressResult({ error: "Task not found" })).toBe(
      null,
    );
    expect(
      normalizeAgentTeamProgressResult([
        ...tasks,
        { ...tasks[0], taskId: "task-4", threadId: "thread-4" },
      ]),
    ).toBeNull();
    expect(
      normalizeAgentTeamProgressResult([{ ...tasks[0], status: "unknown" }]),
    ).toBeNull();
  });

  it("renders queued, working, and completed work as compact cards", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          catalog={toolkitI18nCatalog}
          persistPreference={false}
        >
          <AgentTeamProgressWidget
            context={{
              toolName: "agent-teams",
              args: { action: "list" },
              resultJson: { tasks },
              isRunning: false,
              chatUI: { renderer: "core.agent-team-progress" },
            }}
          />
        </AgentNativeI18nProvider>,
      );
    });

    expect(container.querySelectorAll("[data-action-card]")).toHaveLength(3);
    expect(container.textContent).toContain("Compare signups");
    expect(container.textContent).toContain("Find launch feedback");
    expect(container.textContent).toContain("Draft Monday update");
    expect(container.textContent).toContain("Reading recent mail");
    expect(container.textContent).toContain("Working");
    expect(container.textContent).toContain("queued");
    expect(container.textContent).toContain("finished");
  });
});

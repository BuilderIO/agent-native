// @vitest-environment happy-dom

import {
  AgentNativeI18nProvider as CoreAgentNativeI18nProvider,
  type AgentNativeI18nProviderProps,
} from "@agent-native/core/client/i18n";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { AgentTaskCard } from "./AgentTaskCard.js";

const toolkitI18nCatalog = createToolkitI18nCatalog({ messages: {} });

function AgentNativeI18nProvider(props: AgentNativeI18nProviderProps) {
  return (
    <CoreAgentNativeI18nProvider
      {...props}
      catalog={props.catalog ?? toolkitI18nCatalog}
    />
  );
}

describe("AgentTaskCard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render = root.render.bind(root);
    root.render = (children: ReactNode) =>
      render(
        <AgentNativeI18nProvider persistPreference={false}>
          {children}
        </AgentNativeI18nProvider>,
      );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps failed delegated agents visually neutral in chat", async () => {
    await act(async () => {
      root.render(
        <AgentTaskCard
          taskId="task-1"
          threadId="thread-1"
          description="Generate mockups"
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-task-event", {
          detail: { type: "agent_task", taskId: "task-1", status: "errored" },
        }),
      );
    });

    expect(container.textContent).toContain("Generate mockups");
    expect(container.querySelector(".text-destructive")).toBeNull();
    expect(container.querySelector(".sr-only")?.textContent).toBe("Error");
  });
});

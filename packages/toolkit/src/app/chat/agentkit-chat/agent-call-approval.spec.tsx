// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit";
import type {
  AgentTask,
  AgentTransport,
  AgentWidget,
} from "@agent-native/agentkit/protocol";
import {
  AGENT_CALL_APPROVAL_WIDGET_KIND,
  sendToAgentChat,
} from "@agent-native/core/client/agent-chat";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitProvider } from "../../agentkit/react/context.js";
import { createToolkitI18nCatalog } from "../../i18n.js";
import { AgentKitAgentCallApproval } from "./agent-call-approval.js";

vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChat: vi.fn(),
}));

const sendToAgentChatMock = vi.mocked(sendToAgentChat);
const catalog = createToolkitI18nCatalog({ messages: {} });
const approvalUrl =
  "https://slides.example.com/_agent-native/a2a/approvals/approval-1";
const approval = {
  agent: "Slides",
  id: "approval-1",
  tool: "delete-deck",
  url: approvalUrl,
  taskId: "task-child",
};
const widget: AgentWidget = {
  id: "call-1:approval:approval-1",
  kind: AGENT_CALL_APPROVAL_WIDGET_KIND,
  data: approval,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.sessionStorage.clear();
  sendToAgentChatMock.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function threadClient(tasks: AgentTask[] = []) {
  const transport: AgentTransport = {
    async startRun() {
      return { runId: "run-1" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async getThreadSnapshot() {
      return {
        id: "thread-1",
        createdAt: "2026-11-14T00:00:00.000Z",
        updatedAt: "2026-11-14T00:00:00.000Z",
        messages: [],
        tasks,
      };
    },
  };
  const client = new AgentKitClient({ transport });
  await client.loadThread("thread-1");
  return client;
}

async function renderCard(client: AgentKitClient) {
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitAgentCallApproval value={widget} threadId="thread-1" />
        </AgentKitProvider>
      </AgentNativeI18nProvider>,
    ),
  );
}

function action(id: string) {
  return container.querySelector<HTMLButtonElement>(
    `[data-approval-action="${id}"]`,
  );
}

async function press(id: string) {
  const button = action(id);
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AgentKitAgentCallApproval", () => {
  it("opens the peer's approval page, then continues the same task once", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const client = await threadClient([
      {
        id: "task-child",
        title: "Slides",
        kind: "delegated-agent",
        status: "awaiting_input",
      },
    ]);
    await renderCard(client);

    expect(container.textContent).toContain("Slides needs your approval");
    expect(container.textContent).toContain("delete-deck");
    expect(action("continue")).toBeNull();

    await press("review");
    expect(open).toHaveBeenCalledWith(
      approvalUrl,
      "_blank",
      "noopener,noreferrer",
    );
    expect(sendToAgentChatMock).not.toHaveBeenCalled();

    await press("continue");
    expect(sendToAgentChatMock).toHaveBeenCalledTimes(1);
    const request = sendToAgentChatMock.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      message: "I approved it in Slides. Please continue.",
      submit: true,
    });
    expect(request?.context).toContain(
      'agent="Slides" and taskId="task-child"',
    );
    expect(container.textContent).toBe("");

    // A reload renders the same widget again; it stays closed.
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderCard(client);
    expect(container.textContent).toBe("");
    expect(sendToAgentChatMock).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel without continuing the task", async () => {
    await renderCard(await threadClient());

    await press("cancel");

    expect(container.textContent).toBe("");
    expect(sendToAgentChatMock).not.toHaveBeenCalled();
  });

  it("shows nothing for a saved approval whose link is not a web page", async () => {
    const client = await threadClient();
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
          <AgentKitProvider controller={client} threadId="thread-1">
            <AgentKitAgentCallApproval
              value={{
                ...widget,
                data: { ...approval, url: "javascript:alert(1)" },
              }}
              threadId="thread-1"
            />
          </AgentKitProvider>
        </AgentNativeI18nProvider>,
      ),
    );

    expect(container.textContent).toBe("");
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "stays hidden once the delegated task is %s",
    async (status) => {
      await renderCard(
        await threadClient([
          {
            id: "task-child",
            title: "Slides",
            kind: "delegated-agent",
            status,
          },
        ]),
      );

      expect(container.textContent).toBe("");
    },
  );
});

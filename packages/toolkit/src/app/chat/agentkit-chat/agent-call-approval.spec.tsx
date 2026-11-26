// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit";
import type {
  AgentParticipant,
  AgentTask,
  AgentThreadSnapshot,
  AgentTransport,
  AgentWidget,
} from "@agent-native/agentkit/protocol";
import {
  AGENT_CALL_APPROVAL_WIDGET_KIND,
  sendToAgentChatAndConfirm,
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
  sendToAgentChatAndConfirm: vi.fn(),
}));

const sendMock = vi.mocked(sendToAgentChatAndConfirm);
const catalog = createToolkitI18nCatalog({ messages: {} });
const approvalUrl =
  "https://slides.example.com/_agent-native/a2a/approvals/approval-1";
const approval = {
  agent: "Slides",
  id: "approval-1",
  tool: "delete-deck",
  url: approvalUrl,
  taskId: "task-child",
  callId: "call-1",
};
const widget: AgentWidget = {
  id: "Slides:approval:approval-1",
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
  sendMock.mockReset();
  sendMock.mockResolvedValue({ tabId: "tab-1", delivered: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function threadClient(
  tasks: AgentTask[] = [],
  agents: AgentParticipant[] = [],
  saved: Pick<AgentThreadSnapshot, "messages"> &
    Partial<Pick<AgentThreadSnapshot, "widgets" | "runs" | "activeRunIds">> = {
    messages: [],
  },
) {
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
        ...saved,
        tasks,
        agents,
      };
    },
  };
  const client = new AgentKitClient({ transport });
  await client.loadThread("thread-1");
  return client;
}

async function renderCard(client: AgentKitClient, value: AgentWidget = widget) {
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
        <AgentKitProvider controller={client} threadId="thread-1">
          <AgentKitAgentCallApproval value={value} threadId="thread-1" />
        </AgentKitProvider>
      </AgentNativeI18nProvider>,
    ),
  );
}

// A reload renders the saved widget again in a fresh tree.
async function reload(client: AgentKitClient, value: AgentWidget = widget) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await renderCard(client, value);
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

const waiting = (id: string): AgentParticipant => ({
  id,
  name: "Slides",
  status: "waiting",
  activeTaskId: "task-child",
});

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
    expect(sendMock).not.toHaveBeenCalled();

    await press("continue");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const request = sendMock.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      message: "I approved it in Slides. Please continue.",
      submit: true,
      chatTarget: "local",
    });
    expect(request?.context).toContain(
      'agent="Slides" and taskId="task-child"',
    );
    expect(container.textContent).toBe("");

    await reload(client);
    expect(container.textContent).toBe("");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Continue when the chat did not take the continuation", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    sendMock.mockResolvedValueOnce({
      tabId: "tab-1",
      delivered: false,
      reason: "timeout",
    });
    const client = await threadClient([], [waiting("call-1")]);
    await renderCard(client);
    await press("review");

    await press("continue");
    expect(container.textContent).toContain("Slides needs your approval");
    expect(action("continue")).not.toBeNull();

    await press("continue");
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("");
  });

  it("keeps Continue disabled when the page is reopened while it sends", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    let deliver: (value: { tabId: string; delivered: boolean }) => void = () =>
      undefined;
    sendMock.mockReturnValueOnce(
      new Promise((resolve) => {
        deliver = resolve;
      }),
    );
    await renderCard(await threadClient([], [waiting("call-1")]));
    await press("review");
    await press("continue");
    expect(action("continue")?.disabled).toBe(true);

    await press("review");
    expect(action("continue")?.disabled).toBe(true);

    await act(async () => deliver({ tabId: "tab-1", delivered: true }));
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("");
  });

  it("closes on Dismiss without continuing the task", async () => {
    await renderCard(await threadClient());

    await press("dismiss");

    expect(container.textContent).toBe("");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("comes back when a newer call finds the approval still waiting", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await renderCard(await threadClient([], [waiting("call-1")]));
    await press("review");
    await press("continue");
    expect(container.textContent).toBe("");

    // Continue came before the approval: the continuation is still running.
    await reload(
      await threadClient(
        [],
        [waiting("call-1"), { ...waiting("call-2"), status: "working" }],
      ),
    );
    expect(container.textContent).toBe("");

    // The peer answers with the same approval still waiting, which rewrites
    // this card for the newer call.
    await reload(
      await threadClient([], [waiting("call-1"), waiting("call-2")]),
      { ...widget, data: { ...approval, callId: "call-2" } },
    );
    expect(container.textContent).toContain("Slides needs your approval");
    expect(action("review")).not.toBeNull();
    expect(action("continue")).toBeNull();
  });

  it("comes back in the tab that continued when the resume fails", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await renderCard(await threadClient([], [waiting("call-1")]));
    await press("review");
    await press("continue");
    expect(container.textContent).toBe("");

    // The resume failed and wrote no new card, so the approval may still wait.
    await reload(
      await threadClient(
        [],
        [waiting("call-1"), { ...waiting("call-2"), status: "failed" }],
      ),
    );
    expect(container.textContent).toContain("Slides needs your approval");
  });

  it("stays closed when a call had failed before it was continued", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const failedEarlier = await threadClient(
      [],
      [{ ...waiting("call-0"), status: "failed" }, waiting("call-1")],
    );
    await renderCard(failedEarlier);
    await press("review");
    await press("continue");
    expect(container.textContent).toBe("");

    await reload(failedEarlier);
    expect(container.textContent).toBe("");
  });

  describe("once a run started after Continue ends", () => {
    const run = (
      id: string,
      status: "running" | "completed",
    ): NonNullable<AgentThreadSnapshot["runs"]>[number] => ({
      id,
      threadId: "thread-1",
      status,
      lastSequence: 1,
    });
    const withRuns = (...runs: ReturnType<typeof run>[]) =>
      threadClient([], [waiting("call-1")], {
        messages: [],
        runs,
        activeRunIds: runs
          .filter((each) => each.status === "running")
          .map((each) => each.id),
      });

    it("comes back when that run never resumed the task", async () => {
      vi.spyOn(window, "open").mockReturnValue(null);
      await renderCard(await withRuns(run("run-1", "completed")));
      await press("review");
      await press("continue");
      expect(container.textContent).toBe("");

      // The Continue turn ended without calling the peer again.
      await reload(
        await withRuns(run("run-1", "completed"), run("run-2", "completed")),
      );
      expect(container.textContent).toContain("Slides needs your approval");
      expect(action("review")).not.toBeNull();
    });

    it("stays closed while that run is still going", async () => {
      vi.spyOn(window, "open").mockReturnValue(null);
      await renderCard(await withRuns(run("run-1", "completed")));
      await press("review");
      await press("continue");

      await reload(
        await withRuns(run("run-1", "completed"), run("run-2", "running")),
      );
      expect(container.textContent).toBe("");
    });

    it("stays closed after Dismiss", async () => {
      await renderCard(await withRuns(run("run-1", "completed")));
      await press("dismiss");

      await reload(
        await withRuns(run("run-1", "completed"), run("run-2", "completed")),
      );
      expect(container.textContent).toBe("");
    });
  });

  it("stays closed when the task pauses on a different approval", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    await renderCard(await threadClient([], [waiting("call-1")]));
    await press("review");
    await press("continue");
    expect(container.textContent).toBe("");

    // The continuation ran this approval's action, then paused on another
    // one. That call writes the other approval's card; this one keeps call-1.
    await reload(
      await threadClient([], [waiting("call-1"), waiting("call-2")]),
    );
    expect(container.textContent).toBe("");
  });

  it("shows nothing for a saved approval whose link is not a web page", async () => {
    await renderCard(await threadClient(), {
      ...widget,
      data: { ...approval, url: "javascript:alert(1)" },
    });

    expect(container.textContent).toBe("");
  });

  it("still shows after the chat's own turn ends with the task paused", async () => {
    // The chat settles a paused task when its turn ends; the peer is still
    // waiting on the approval.
    await renderCard(
      await threadClient(
        [
          {
            id: "task-child",
            title: "Slides",
            kind: "delegated-agent",
            status: "completed",
          },
        ],
        [waiting("call-1")],
      ),
    );

    expect(container.textContent).toContain("Slides needs your approval");
  });

  it("stays hidden once a later call on the task has completed", async () => {
    await renderCard(
      await threadClient(
        [],
        [waiting("call-1"), { ...waiting("call-2"), status: "completed" }],
      ),
    );

    expect(container.textContent).toBe("");
  });

  it("still shows when a later call failed to resume the task", async () => {
    // A failed resume says nothing about the approval, which may still wait.
    await renderCard(
      await threadClient(
        [],
        [waiting("call-1"), { ...waiting("call-2"), status: "failed" }],
      ),
    );

    expect(container.textContent).toContain("Slides needs your approval");
  });

  describe("while another call resumes the task", () => {
    const resuming = [
      waiting("call-1"),
      { ...waiting("call-2"), status: "working" as const },
    ];
    const runGoing = (agents: AgentParticipant[]) =>
      threadClient([], agents, {
        messages: [],
        runs: [
          {
            id: "run-2",
            threadId: "thread-1",
            status: "running",
            lastSequence: 1,
          },
        ],
        activeRunIds: ["run-2"],
      });

    it("hides in a tab that never continued", async () => {
      await renderCard(await runGoing(resuming));

      expect(container.textContent).toBe("");
    });

    it("still shows while a new request to the same app runs", async () => {
      // A new request names no task until it ends; a resume names its own.
      await renderCard(
        await runGoing([
          waiting("call-1"),
          { id: "call-2", name: "Slides", status: "working" },
        ]),
      );

      expect(container.textContent).toContain("Slides needs your approval");
    });

    it("shows again once no run is going", async () => {
      // A stopped run can leave its call marked working.
      await renderCard(await threadClient([], resuming));

      expect(container.textContent).toContain("Slides needs your approval");
    });
  });

  describe("once the task waits on a later approval", () => {
    const reply = (id: string) => ({
      id,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Slides is waiting." }],
    });
    const later: AgentWidget = {
      id: "Slides:approval:approval-2",
      kind: AGENT_CALL_APPROVAL_WIDGET_KIND,
      data: { ...approval, id: "approval-2", callId: "call-2" },
    };
    // A new tab: the saved thread, and no marker from the tab that continued.
    const savedThread = () =>
      threadClient([], [waiting("call-1"), waiting("call-2")], {
        messages: [reply("reply-1"), reply("reply-2")],
        widgets: [
          { messageId: "reply-1", widget },
          { messageId: "reply-2", widget: later },
        ],
      });

    it("hides the earlier approval's card in any tab", async () => {
      await renderCard(await savedThread());

      expect(container.textContent).toBe("");
    });

    it("shows the later approval's card", async () => {
      await renderCard(await savedThread(), later);

      expect(container.textContent).toContain("Slides needs your approval");
    });
  });
});

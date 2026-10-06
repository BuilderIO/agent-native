// @vitest-environment happy-dom

import { AgentKitClient } from "@agent-native/agentkit";
import type {
  AgentApprovalRequest,
  AgentThreadSnapshot,
  AgentTransport,
} from "@agent-native/agentkit/protocol";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentKitChat } from "../../agentkit/react/components.js";
import { AgentKitProvider } from "../../agentkit/react/context.js";
import { CoreAgentKitApproval } from "./approval-card.js";
import { CoreAgentKitRoot } from "./root.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) =>
    key === "agentChat.approval.question"
      ? `Approve to run ${String(options?.tool)}?`
      : key === "agentChat.approval.releaseSummary"
        ? `Release ${String(options?.release)} to ${String(options?.environment)}`
        : key === "agentChat.approval.releaseSummaryWithoutEnvironment"
          ? `Release ${String(options?.release)}`
          : key === "agentChat.approval.editPrompt"
            ? "Ask me how I want to revise this action before trying again."
            : key === "agentChat.approval.action"
              ? "the requested action"
              : key === "agentChat.approval.approve"
                ? "Approve"
                : key === "agentChat.approval.deny"
                  ? "Deny"
                  : key === "agentChat.approval.edit"
                    ? "Edit"
                    : key === "agentChat.approval.pending"
                      ? "Approval needed"
                      : key,
}));

const request: AgentApprovalRequest = {
  id: "approval-1",
  title: "SECRET_MESSAGE_BODY",
  kind: "approval",
  metadata: {
    toolName: "send_email",
    input: { body: "SECRET_RAW_ARGS" },
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function createTransport(
  overrides: Partial<AgentTransport> = {},
): AgentTransport {
  return {
    capabilities: { approvals: true },
    async startRun() {
      return { runId: "revised-run" };
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async resolveApproval() {},
    ...overrides,
  };
}

function renderApproval(client: AgentKitClient, value = request) {
  act(() =>
    root.render(
      <AgentKitProvider controller={client} threadId="thread-1">
        <CoreAgentKitApproval
          value={value}
          threadId="thread-1"
          runId="pending-run"
        />
      </AgentKitProvider>,
    ),
  );
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("CoreAgentKitApproval", () => {
  it("resolves Approve through AgentKit's approval control", async () => {
    const resolveApproval = vi.fn(async () => undefined);
    const startRun = vi.fn(async () => ({ runId: "revised-run" }));
    const client = new AgentKitClient({
      transport: createTransport({ resolveApproval, startRun }),
    });
    renderApproval(client);

    await clickButton("Approve");

    expect(resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        runId: "pending-run",
        approvalId: "approval-1",
        response: { decision: "approve", optionIds: ["approve"] },
      }),
      expect.any(Object),
    );
    expect(startRun).not.toHaveBeenCalled();
  });

  it("uses a generic summary when the tool name is not safe to display", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    renderApproval(client, {
      ...request,
      title: "SECRET_MESSAGE_BODY",
      metadata: {
        toolName: "send_email PRIVATE MESSAGE BODY",
        input: { body: "SECRET_RAW_ARGS" },
      },
    });

    expect(container.textContent).toContain(
      "Approve to run the requested action?",
    );
    expect(container.textContent).not.toContain("SECRET_MESSAGE_BODY");
    expect(container.textContent).not.toContain("SECRET_RAW_ARGS");
    expect(container.textContent).not.toContain("PRIVATE MESSAGE BODY");
  });

  it("summarizes an allowlisted release target without exposing other inputs", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    renderApproval(client, {
      ...request,
      metadata: {
        toolName: "accept-agentkit-release",
        input: {
          release: "agentkit-acceptance",
          environment: "production",
          body: "SECRET_RAW_ARGS",
        },
      },
    });

    expect(container.textContent).toContain(
      "Release agentkit-acceptance to production",
    );
    expect(container.textContent).not.toContain("SECRET_RAW_ARGS");
  });

  it("omits an invalid release target from the approval summary", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    renderApproval(client, {
      ...request,
      metadata: {
        toolName: "accept-agentkit-release",
        input: {
          release: "agentkit-acceptance\nprivate data",
          environment: "production",
        },
      },
    });

    expect(container.textContent).toContain(
      "Approve to run accept agentkit release?",
    );
    expect(container.textContent).not.toContain("private data");
  });

  it("omits a release summary when its environment is unsafe", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    renderApproval(client, {
      ...request,
      metadata: {
        toolName: "accept-agentkit-release",
        input: {
          release: "agentkit-acceptance",
          environment: "production\nSECRET_ENV_VALUE",
        },
      },
    });

    expect(container.textContent).toContain(
      "Approve to run accept agentkit release?",
    );
    expect(container.textContent).not.toContain("SECRET_ENV_VALUE");
  });

  it("queues an Edit prompt before denying approval", async () => {
    const callOrder: string[] = [];
    const resolveApproval = vi.fn(async () => {
      callOrder.push("resolve");
    });
    const queueMessage = vi.fn(async (input) => {
      callOrder.push("queue");
      return {
        message: {
          id: "queued-edit",
          threadId: input.threadId,
          text: input.text,
          createdAt: "2026-09-27T00:00:00.000Z",
          metadata: input.metadata,
        },
      };
    });
    const startRun = vi.fn(async () => {
      callOrder.push("send");
      return { runId: "revised-run" };
    });
    const client = new AgentKitClient({
      transport: createTransport({
        capabilities: { approvals: true, messageQueue: true },
        queueMessage,
        resolveApproval,
        startRun,
      }),
    });
    renderApproval(client);

    await clickButton("Edit");

    expect(queueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        text: "Ask me how I want to revise this action before trying again.",
        metadata: { "agent-native.core.approval-edit": "approval-1" },
      }),
      expect.any(Object),
    );
    expect(resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        runId: "pending-run",
        approvalId: "approval-1",
        response: { decision: "deny", optionIds: ["deny"] },
      }),
      expect.any(Object),
    );
    expect(callOrder).toEqual(["queue", "resolve"]);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("keeps Edit pending when queueing fails and reuses a queued prompt on retry", async () => {
    const queueMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce({
        message: {
          id: "queued-edit",
          threadId: "thread-1",
          text: "Ask me how I want to revise this action before trying again.",
          createdAt: "2026-09-27T00:00:00.000Z",
          metadata: { "agent-native.core.approval-edit": "approval-1" },
        },
      });
    const resolveApproval = vi
      .fn()
      .mockRejectedValueOnce(new Error("approval unavailable"))
      .mockResolvedValueOnce(undefined);
    const client = new AgentKitClient({
      transport: createTransport({
        capabilities: { approvals: true, messageQueue: true },
        queueMessage,
        resolveApproval,
      }),
    });
    renderApproval(client);

    await clickButton("Edit");
    expect(resolveApproval).not.toHaveBeenCalled();
    expect(container.textContent).toContain("queue unavailable");
    expect(container.textContent).toContain("Deny");

    await clickButton("Edit");
    expect(queueMessage).toHaveBeenCalledTimes(2);
    expect(resolveApproval).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("approval unavailable");

    await clickButton("Edit");
    expect(queueMessage).toHaveBeenCalledTimes(2);
    expect(resolveApproval).toHaveBeenCalledTimes(2);
  });

  it("denies without asking for a revised action", async () => {
    const callOrder: string[] = [];
    const resolveApproval = vi.fn(async () => {
      callOrder.push("resolve");
    });
    const startRun = vi.fn(async () => {
      callOrder.push("send");
      return { runId: "revised-run" };
    });
    const client = new AgentKitClient({
      transport: createTransport({ resolveApproval, startRun }),
    });
    renderApproval(client);

    await clickButton("Deny");

    expect(resolveApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        runId: "pending-run",
        approvalId: "approval-1",
        response: { decision: "deny", optionIds: ["deny"] },
      }),
      expect.any(Object),
    );
    expect(callOrder).toEqual(["resolve"]);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("restores a pending approval from a thread snapshot in the transcript", async () => {
    const snapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
      messages: [],
      approvals: [{ request, status: "pending", runId: "pending-run" }],
    };
    const client = new AgentKitClient({
      transport: createTransport({
        async getThreadSnapshot() {
          return snapshot;
        },
      }),
    });
    await client.loadThread("thread-1");

    const child: ReactNode = <AgentKitChat composer={false} />;
    const markup = renderToStaticMarkup(
      <CoreAgentKitRoot controller={client} threadId="thread-1" load="manual">
        {child}
      </CoreAgentKitRoot>,
    );

    expect(markup).toContain("agentkit-transcript");
    expect(markup).toContain('class="agentkit-approval"');
    expect(markup).toContain("Approve to run send email?");
    expect(markup).toContain("Approve");
    expect(markup).toContain("Deny");
    expect(markup).toContain("Edit");
    expect(markup).not.toContain("SECRET_MESSAGE_BODY");
    expect(markup).not.toContain("SECRET_RAW_ARGS");

    const customMarkup = renderToStaticMarkup(
      <CoreAgentKitRoot
        controller={client}
        threadId="thread-1"
        load="manual"
        slots={{ approval: () => <output>Custom approval slot</output> }}
      >
        {child}
      </CoreAgentKitRoot>,
    );
    expect(customMarkup).toContain("Custom approval slot");
    expect(customMarkup).not.toContain("Edit");
  });

  it("keeps choice and input approvals on AgentKit's existing prompt", () => {
    const choice: AgentApprovalRequest = {
      id: "choice-1",
      title: "Choose a destination",
      kind: "choice",
      options: [{ id: "staging", label: "Staging" }],
    };
    const client = new AgentKitClient({ transport: createTransport() });
    renderApproval(client, choice);

    expect(
      container.querySelector(".agentkit-approval-options"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Staging");

    renderApproval(client, {
      id: "input-1",
      title: "Provide a title",
      kind: "input",
      input: { id: "title", label: "Title" },
    });
    expect(container.querySelector(".agentkit-approval-input")).not.toBeNull();
  });
});

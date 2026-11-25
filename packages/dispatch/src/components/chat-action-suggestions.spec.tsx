// @vitest-environment happy-dom

import { createAgentThreadState } from "@agent-native/agentkit/client";
import type { ActionSuggestion } from "@agent-native/agentkit/protocol";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useThread: vi.fn(),
  useMutation: vi.fn(),
  mutate: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@agent-native/toolkit/app/agentkit/react", () => ({
  useAgentThread: mocks.useThread,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: mocks.useMutation,
  actionErrorCode: (error?: { errorCode?: string }) => error?.errorCode,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: mocks.sendMessage,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () => (_key: string, options: { defaultValue: string; label?: string }) =>
      options.defaultValue.replace("{{label}}", options.label ?? ""),
}));

import { ChatActionSuggestions } from "./chat-action-suggestions.js";

const filter = {
  id: "human-notifications",
  kind: "filter",
  trigger: "ai-narrowing",
  label: "Save human notifications",
  rationale: "See replies from people in one view.",
  appId: "workspace/mail",
  execution: {
    type: "action",
    action: "create-split",
    params: { senderType: "human" },
  },
} satisfies ActionSuggestion;

const automation = {
  ...filter,
  id: "triage-reminder",
  kind: "automation",
  trigger: "repeated-query",
  label: "Remind me to triage notifications",
  execution: {
    type: "action",
    action: "create-reminder",
    params: { cadence: "daily", assignee: null, enabled: false },
  },
} satisfies ActionSuggestion;

const build = {
  id: "equipment-tracker",
  kind: "create-app",
  trigger: "new-domain",
  label: "Build equipment tracker",
  rationale: "Track shared equipment.",
  appId: "dispatch",
  execution: {
    type: "create-app",
    domainSpec: "Track equipment and due dates.",
  },
} satisfies ActionSuggestion;

function doneThread() {
  const thread = createAgentThreadState("thread");
  thread.runs.run = { id: "run", status: "completed", lastSequence: 8 };
  return thread;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.useMutation.mockReturnValue({ mutateAsync: mocks.mutate });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () =>
    root.render(<ChatActionSuggestions threadId="thread" />),
  );
}

function chip(label: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.firstElementChild?.textContent === label,
  );
}

it("shows at most two suggestions from real tool result shapes and executes the selected action directly", async () => {
  const thread = doneThread();
  thread.tools.foreign = {
    id: "foreign",
    name: "call_app_action",
    runId: "run",
    status: "completed",
    input: { app: "another-workspace/mail" },
    output: {
      structuredContent: {
        suggestions: [
          { ...filter, id: "foreign", label: "Foreign suggestion" },
        ],
      },
    },
  };
  thread.tools.destructive = {
    id: "destructive",
    name: "call_app_action",
    runId: "run",
    status: "completed",
    input: { app: filter.appId },
    output: {
      structuredContent: {
        suggestions: [
          {
            ...filter,
            id: "delete-split",
            label: "Organize this inbox",
            execution: { type: "action", action: "delete-split", params: {} },
          },
        ],
      },
    },
  };
  thread.tools.app = {
    id: "app",
    name: "call_app_action",
    runId: "run",
    status: "completed",
    input: { app: filter.appId },
    output: JSON.stringify({
      structuredContent: { suggestions: [filter, automation] },
      content: [],
    }),
  };
  thread.tools.turn = {
    id: "turn",
    name: "propose-action-suggestions",
    runId: "run",
    status: "completed",
    output: JSON.stringify({ suggestions: [filter, build] }),
  };
  mocks.useThread.mockReturnValue(thread);
  mocks.mutate.mockResolvedValue({
    suggestionId: filter.id,
    status: "accepted",
    outcome: "action-completed",
  });

  await render();
  expect(chip("Foreign suggestion")).toBeUndefined();
  expect(chip("Organize this inbox")).toBeUndefined();
  expect(chip(filter.label)?.textContent).toContain(
    "workspace/mail · create-split",
  );
  expect(chip(build.label)).toBeUndefined();
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Dismiss ${automation.label}"]`,
      )
      ?.click(),
  );
  expect(chip(automation.label)).toBeUndefined();
  expect(mocks.mutate).not.toHaveBeenCalled();
  await act(async () => chip(filter.label)?.click());
  expect(mocks.useMutation).toHaveBeenCalledWith("execute-action-suggestion", {
    uiOnly: true,
    retry: false,
  });
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ suggestion: filter });
  expect(mocks.sendMessage).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Suggestion accepted.",
  );
});

it("shows a turn-level suggestion after completion without an app tool result", async () => {
  const thread = doneThread();
  thread.runs.run.status = "running";
  thread.tools.turn = {
    id: "turn",
    name: "propose-action-suggestions",
    runId: "run",
    status: "completed",
    output: JSON.stringify({ suggestions: [build] }),
  };
  mocks.useThread.mockReturnValue(thread);
  await render();
  expect(chip(build.label)).toBeUndefined();

  mocks.useThread.mockReturnValue({
    ...thread,
    runs: { run: { ...thread.runs.run, status: "completed" } },
  });
  await render();
  expect(chip(build.label)).toBeDefined();
});

it("surfaces an actionable approval review instead of a success receipt", async () => {
  const thread = doneThread();
  thread.tools.turn = {
    id: "turn",
    name: "propose-action-suggestions",
    runId: "run",
    status: "completed",
    output: { suggestions: [filter] },
  };
  mocks.useThread.mockReturnValue(thread);
  const url =
    "https://mail.example.test/#mcpApproval=00000000-0000-4000-8000-000000000000";
  mocks.mutate.mockRejectedValue(
    Object.assign(new Error("Pending approval"), {
      errorCode: "approval_required",
      details: { approvalReview: { url } },
    }),
  );

  await render();
  await act(async () => chip(filter.label)?.click());
  expect(container.querySelector("[role=alert] a")?.getAttribute("href")).toBe(
    url,
  );
  expect(container.querySelector("[role=status]")).toBeNull();
});

it.each([
  [automation, "daily", "Cadence"],
  [build, build.execution.domainSpec, "Create app in this workspace"],
  [
    {
      ...build,
      kind: "customize-app",
      appId: "workspace/mail",
      execution: {
        type: "customize",
        targetAppId: "workspace/mail",
        editSpec: "Set the default inbox column.",
      },
    } satisfies ActionSuggestion,
    "Set the default inbox column.",
    "Customize",
  ],
])(
  "shows the concrete payload and waits for confirmation for $id",
  async (suggestion, payload, label) => {
    const thread = doneThread();
    thread.tools.turn = {
      id: "turn",
      name: "propose-action-suggestions",
      runId: "run",
      status: "completed",
      output: { suggestions: [suggestion] },
    };
    mocks.useThread.mockReturnValue(thread);
    mocks.mutate.mockResolvedValue({
      suggestionId: suggestion.id,
      status: "accepted",
      outcome: "action-completed",
    });
    await render();
    await act(async () => chip(suggestion.label)?.click());
    expect(mocks.mutate).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(payload);
    expect(dialog?.querySelector("pre")).toBeNull();
    expect(dialog?.textContent).toContain(label);
    expect(dialog?.textContent).not.toContain("{\n");
    const run = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Run action",
    );
    await act(async () => run?.click());
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ suggestion });
  },
);

it("offers the existing app after confirmation", async () => {
  const thread = doneThread();
  thread.tools.turn = {
    id: "turn",
    name: "propose-action-suggestions",
    runId: "run",
    status: "completed",
    output: { suggestions: [build] },
  };
  mocks.useThread.mockReturnValue(thread);
  mocks.mutate.mockResolvedValue({
    suggestionId: build.id,
    status: "accepted",
    outcome: "action-completed",
    url: "https://equipment.example.test/",
  });
  await render();
  await act(async () => chip(build.label)?.click());
  const run = [...document.querySelectorAll('[role="dialog"] button')].find(
    (button) => button.textContent === "Run action",
  );
  await act(async () =>
    run?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ suggestion: build });
  expect(
    container.querySelector('[role="status"] a')?.getAttribute("href"),
  ).toBe("https://equipment.example.test/");
});

it("shows explicit null and boolean values in the review", async () => {
  const thread = doneThread();
  thread.tools.turn = {
    id: "turn",
    name: "propose-action-suggestions",
    runId: "run",
    status: "completed",
    output: { suggestions: [automation] },
  };
  mocks.useThread.mockReturnValue(thread);
  await render();
  await act(async () => chip(automation.label)?.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("AssigneeNone");
  expect(dialog?.textContent).toContain("EnabledNo");
});

it("summarizes the action and its arguments as labeled text", async () => {
  const thread = doneThread();
  thread.tools.turn = {
    id: "turn",
    name: "propose-action-suggestions",
    runId: "run",
    status: "completed",
    output: { suggestions: [automation] },
  };
  mocks.useThread.mockReturnValue(thread);
  await render();
  await act(async () => chip(automation.label)?.click());
  const text = document.querySelector('[role="dialog"]')?.textContent ?? "";
  expect(text).toContain("ActionCreate reminder");
  expect(text).toContain("Appworkspace/mail");
  expect(text).toContain("Cadencedaily");
  expect(text).not.toMatch(/[{}"]/);
});

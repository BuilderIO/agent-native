// @vitest-environment happy-dom

import { appendAgentChatContextToMessage } from "@agent-native/core/shared";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { useAskThreadAdmission } from "./useAskThreadAdmission";

const actions = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: (error: { errorCode?: string }) => error.errorCode,
  callAction: actions.call,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  notifyChatThreadsUpdated: vi.fn(),
}));

it("retries a failed first attachment against the same binding and submits the initial question once", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const binding = {
    threadId: "bound-thread",
    projectId: "bound-project",
    bindingId: "binding",
    workingVersionId: "version",
    href: "/thread/bound-thread",
  };
  let uploads = 0;
  actions.call.mockImplementation(async (action, input) => {
    if (action === "start-analytics-thread") {
      expect(input.trigger.kind).toBe("attach");
      return {
        ...binding,
        phase: "awaiting_upload",
        initialTurn: null,
        uploadSlots: input.trigger.uploads.map(
          ({ clientFileId }: { clientFileId: string }) => ({
            clientFileId,
            uploadId: "upload-slot",
            state: "pending",
          }),
        ),
      };
    }
    if (action === "upload-project-file") {
      uploads += 1;
      if (uploads === 1) throw new Error("Temporary upload failure");
      return { file: { id: "scoped-file" } };
    }
    if (
      action === "record-analytics-thread-upload" ||
      action === "submit-analytics-thread-turn"
    )
      return {};
    throw new Error(`Unexpected action ${action}`);
  });
  const goToThread = vi.fn();
  const file = new File(["channel,orders\nweb,1\n"], "orders.csv", {
    type: "text/csv",
  });
  const validateScope = vi.fn();
  let admission: ReturnType<typeof useAskThreadAdmission> | undefined;
  function Composer() {
    admission = useAskThreadAdmission({
      binding: null,
      mode: "ask",
      goToThread,
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<Composer />));
    await act(async () => admission?.onAttachmentsChange([file]));
    expect(admission?.failedFile).toBe(file);
    expect(goToThread).not.toHaveBeenCalled();
    expect(
      actions.call.mock.calls.filter(
        ([action]) => action === "submit-analytics-thread-turn",
      ),
    ).toHaveLength(0);
    await act(async () => {
      await admission?.retryUpload();
    });
    expect(admission?.failedFile).toBeNull();
    await act(async () => {
      await admission?.admit({
        files: [file],
        text: "How many orders?",
        references: [],
        model: "fixture-model",
        validateScope,
      });
    });
    expect(goToThread).toHaveBeenCalledExactlyOnceWith(binding.href);
    expect(
      actions.call.mock.calls.filter(
        ([action]) => action === "start-analytics-thread",
      ),
    ).toHaveLength(1);
    expect(
      actions.call.mock.calls
        .filter(([action]) => action === "record-analytics-thread-upload")
        .map(([, input]) => input),
    ).toEqual([
      { threadId: binding.threadId, uploadId: "upload-slot", attachment: null },
      {
        threadId: binding.threadId,
        uploadId: "upload-slot",
        attachment: "scoped-file",
      },
    ]);
    expect(
      actions.call.mock.calls.filter(
        ([action]) => action === "submit-analytics-thread-turn",
      ),
    ).toEqual([
      [
        "submit-analytics-thread-turn",
        {
          threadId: binding.threadId,
          messageId: expect.any(String),
          prompt: {
            text: "How many orders?",
            attachmentIds: ["upload-slot"],
            modelId: "fixture-model",
            mentions: [],
            sourceIds: [],
            approval: "ask",
          },
        },
      ],
    ]);
    expect(uploads).toBe(2);
  } finally {
    act(() => root.unmount());
  }
});

it("submits exactly the typed question when the composer appends its context", async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const binding = {
    threadId: "bound-thread",
    projectId: "bound-project",
    bindingId: "binding",
    workingVersionId: "version",
    href: "/thread/bound-thread",
  };
  actions.call.mockReset();
  actions.call.mockResolvedValue({});
  const typed = "Compare web & app <context> orders";
  let admission: ReturnType<typeof useAskThreadAdmission> | undefined;
  function Composer() {
    admission = useAskThreadAdmission({
      binding,
      mode: "ask",
      goToThread: vi.fn(),
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    act(() => root.render(<Composer />));
    await act(async () => {
      await admission?.admit({
        files: [],
        text: appendAgentChatContextToMessage(
          typed,
          "## Workspace app\nCurrent URL: /home",
        ),
        references: [],
        validateScope: vi.fn(),
      });
    });
    expect(actions.call).toHaveBeenCalledExactlyOnceWith(
      "submit-analytics-thread-turn",
      expect.objectContaining({
        threadId: binding.threadId,
        prompt: expect.objectContaining({ text: typed, attachmentIds: [] }),
      }),
    );
  } finally {
    act(() => root.unmount());
  }
});

async function admitFromHome(text: string) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const goToThread = vi.fn();
  const slot: { admission?: ReturnType<typeof useAskThreadAdmission> } = {};
  function Composer() {
    slot.admission = useAskThreadAdmission({
      binding: null,
      mode: "ask",
      goToThread,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  try {
    act(() => root.render(<Composer />));
    await act(async () => {
      await slot.admission?.admit({
        files: [],
        text,
        references: [],
        model: "fixture-model",
        validateScope: vi.fn(),
      });
    });
  } finally {
    act(() => root.unmount());
  }
  return { goToThread };
}

it("lands on the named project from Home without starting a thread", async () => {
  actions.call.mockReset();
  actions.call.mockImplementation(async (action) => {
    if (action === "resolve-open-project-intent")
      return {
        status: "found",
        projectId: "prj_orders",
        title: "Orders by month — demo data",
        href: "/project/prj_orders/latest",
      };
    throw new Error(`Unexpected action ${action}`);
  });
  const { goToThread } = await admitFromHome(
    "open project Orders by month - demo",
  );
  expect(goToThread).toHaveBeenCalledExactlyOnceWith(
    "/project/prj_orders/latest",
  );
  expect(actions.call.mock.calls.map(([action]) => action)).toEqual([
    "resolve-open-project-intent",
  ]);
  expect(actions.call.mock.calls[0]?.[1]).toEqual({
    title: "Orders by month - demo",
  });
});

it.each([
  ["no project has that title", { status: "none" }],
  ["the title is ambiguous", { status: "ambiguous" }],
])("asks the agent when %s", async (_name, resolved) => {
  actions.call.mockReset();
  const binding = {
    threadId: "new-thread",
    projectId: "new-project",
    bindingId: "binding",
    workingVersionId: "version",
    href: "/thread/new-thread",
  };
  actions.call.mockImplementation(async (action) => {
    if (action === "resolve-open-project-intent") return resolved;
    if (action === "start-analytics-thread")
      return { ...binding, phase: "submitted", uploadSlots: [] };
    throw new Error(`Unexpected action ${action}`);
  });
  const { goToThread } = await admitFromHome("open project Orders");
  expect(goToThread).toHaveBeenCalledExactlyOnceWith(binding.href);
  expect(
    actions.call.mock.calls.filter(
      ([action]) => action === "start-analytics-thread",
    ),
  ).toHaveLength(1);
});

it("keeps ordinary questions on the Ask flow without resolving a project", async () => {
  actions.call.mockReset();
  actions.call.mockImplementation(async (action) => {
    if (action === "start-analytics-thread")
      return {
        threadId: "t",
        projectId: "p",
        bindingId: "b",
        workingVersionId: "v",
        href: "/thread/t",
        phase: "submitted",
        uploadSlots: [],
      };
    throw new Error(`Unexpected action ${action}`);
  });
  await admitFromHome("How many orders did we get last month?");
  expect(actions.call.mock.calls.map(([action]) => action)).toEqual([
    "start-analytics-thread",
  ]);
});

it("opens the dashboard a question names and hands the question to it, without starting a Home thread", async () => {
  actions.call.mockReset();
  actions.call.mockImplementation(async (action) => {
    if (action === "resolve-open-project-intent")
      return {
        status: "found",
        projectId: "prj_v3",
        title: "Agent-Native - BigQuery v3",
        href: "/project/prj_v3/latest",
      };
    throw new Error(`Unexpected action ${action}`);
  });
  const question = "How's my Agent-Native metrics doing in my V3 dashboard?";
  const { goToThread } = await admitFromHome(question);
  expect(goToThread).toHaveBeenCalledExactlyOnceWith("/project/prj_v3/latest", {
    state: { askQuestion: question },
  });
  expect(actions.call.mock.calls.map(([action]) => action)).toEqual([
    "resolve-open-project-intent",
  ]);
  expect(actions.call.mock.calls[0]?.[1]).toEqual({
    title: "V3",
    question,
  });
});

it("asks the agent in a Home thread when the named dashboard is not one project", async () => {
  actions.call.mockReset();
  const binding = {
    threadId: "new-thread",
    projectId: "new-project",
    bindingId: "binding",
    workingVersionId: "version",
    href: "/thread/new-thread",
  };
  actions.call.mockImplementation(async (action) => {
    if (action === "resolve-open-project-intent")
      return { status: "ambiguous" };
    if (action === "start-analytics-thread")
      return { ...binding, phase: "submitted", uploadSlots: [] };
    throw new Error(`Unexpected action ${action}`);
  });
  const { goToThread } = await admitFromHome("How's my V3 dashboard doing?");
  expect(goToThread).toHaveBeenCalledExactlyOnceWith(binding.href);
});

// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell, ProjectDocument } from "@/lib/model/contracts";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import { resultIdSchema } from "../../../shared/notebook-execution";
import { NotebookCell } from "./NotebookCell";
import { ProjectEditor } from "./ProjectEditor";
import { PythonCellOutput } from "./PythonCellOutput";
import type { NotebookOutputs } from "./types";
import { cellCollapseStorageKey } from "./useCellCollapse";
import type { NotebookRunIntent } from "./useNotebookRun";

const page = vi.hoisted(() => ({
  status: "ready",
  page: 1,
  manifest: {
    status: "complete",
    rowCount: "1",
    fields: [{ name: "n", type: "integer" }],
  },
  rows: [[126]],
  view: { page: 1, viewRevision: "0" },
}));
const sendToAgent = vi.hoisted(() => vi.fn());
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: sendToAgent,
}));
vi.mock("@agent-native/core/client/hooks", () => {
  const reads: Record<string, unknown> = {
    "get-notebook-result-page": page,
    "list-data-statuses": { statuses: [], defaultStatusId: null },
    "list-project-categories": { categories: [], assignments: [] },
    "get-workspace-shell": {
      features: { isManagerOrAbove: false, isAdmin: false },
    },
  };
  return {
    getBrowserTabId: () => "test-tab",
    actionErrorCode: () => null,
    actionErrorMessage: () => null,
    writeClientAppState: vi.fn(async () => {}),
    callAction: vi.fn(),
    useActionMutation: () => ({ mutateAsync: vi.fn(async () => ({})) }),
    useActionQuery: (name: string) => ({
      data: reads[name],
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/client/resources/use-resources", () => ({
  useResources: () => ({ data: [] }),
  useResource: () => ({ data: undefined }),
}));

const timestamp = "2026-11-18T00:00:00.000Z";
const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  outputResult: true,
};
const query: Cell = {
  id: "sql",
  projectId: "project",
  versionId: "draft",
  createdAt: timestamp,
  updatedAt: timestamp,
  contents: {
    ...base,
    id: "sql",
    order: "a1",
    kind: "sql",
    source: "select 42 as n union all select 84",
    dataConnectionId: null,
    connectionMode: "dataframes",
    databaseSchema: null,
    resultVariable: "dataframe",
  },
};
const python: Cell & { contents: Extract<Cell["contents"], { kind: "code" }> } =
  {
    ...query,
    id: "code",
    contents: {
      ...base,
      id: "code",
      order: "a2",
      kind: "code",
      source: "",
      language: "python",
      resultVariable: null,
    },
  };
const project: ProjectDocument = {
  id: query.projectId,
  title: "Python notebook",
  ownerEmail: "analyst@example.test",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  collectionIds: [],
  cells: [query],
  workingVersionId: query.versionId,
  publishedVersionId: null,
};

it("mounts Python at its notebook position, flushes edits, and reopens ordered output and live variables", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  const start = vi.fn(async (_intent: NotebookRunIntent) => true);
  const onSave = vi.fn();
  const source =
    'import pandas as pd\ntotal = int(dataframe["n"].sum())\nprint("before display")\ndisplay(pd.DataFrame({"n":[total]}))\ntotal + 1';
  const output: NotebookOutputs = {
    code: {
      status: "complete",
      pythonOutputs: [
        { kind: "stream", channel: "stdout", text: "before display\n" },
        { kind: "table", resultId: resultIdSchema.parse("display-result") },
        { kind: "text", data: "127", value: 127 },
      ],
      exports: [
        {
          name: "total",
          kind: "scalar",
          type: "int",
          referenceCount: 1,
          preview: "126",
        },
      ],
    },
  };
  const pythonRun = capabilityDecisionSchema.parse({
    controlId: ANALYTICS_CONTROL_IDS.runDraftPython,
    scope: {
      kind: "cell",
      workspaceId: "workspace",
      projectId: project.id,
      cellId: python.id,
    },
    status: "allowed",
    target: { kind: "action", actionName: "start-notebook-run" },
  });
  function Harness({ reopened }: { reopened: boolean }) {
    const [cells, setCells] = useState<ProjectDocument["cells"]>(
      reopened
        ? [query, { ...python, contents: { ...python.contents, source } }]
        : [query],
    );
    const [outputs, setOutputs] = useState<NotebookOutputs>(
      reopened ? output : {},
    );
    return (
      <ProjectEditor
        project={{ ...project, cells }}
        capabilities={[pythonRun]}
        connections={[]}
        supportedAddKinds={["sql", "code"]}
        outputs={outputs}
        onRename={async () => {}}
        onSaveCell={async (id, contents) => {
          onSave(id, contents);
          setCells((current) =>
            current.map((cell) =>
              cell.id === id ? { ...cell, contents } : cell,
            ),
          );
          return timestamp;
        }}
        onAddCell={async (kind) => {
          expect(kind).toBe("code");
          setCells([query, python]);
          return python.id;
        }}
        onDeleteCell={async () => {}}
        onSelectConnection={async () => {}}
        execution={{
          ready: true,
          cells: undefined,
          defaultMode: "auto",
          autoRerun: true,
          run: null,
          runningIds: new Set(),
          pending: false,
          restarting: false,
          stopping: false,
          session: {
            status: "found",
            generation: "1",
            state: "idle",
            variables: [
              {
                name: "total",
                kind: "scalar",
                type: "int",
                preview: "126",
                producerCellId: "code",
              },
              { name: "pd", kind: "module", type: "module" },
            ],
          },
          start: async (intent) => {
            const admitted = await start(intent);
            if ("cellId" in intent) setOutputs(output);
            return admitted;
          },
          cancel: async () => {},
          restart: async () => {},
          setSettings: async () => {},
        }}
      />
    );
  }
  const render = async (reopened: boolean) =>
    act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <MemoryRouter>
            <Harness reopened={reopened} />
          </MemoryRouter>
        </AgentNativeI18nProvider>,
      );
    });
  const button = (name: string) =>
    Array.from(host.querySelectorAll("button")).find(
      (item) =>
        item.textContent?.trim() === name ||
        item.getAttribute("aria-label") === name,
    );
  const collapseKey = cellCollapseStorageKey(
    { cellId: python.id, projectId: project.id },
    "output",
  );
  assert(collapseKey);
  const result = () => host.querySelector('[aria-label="Python output"]');
  const exports = () =>
    host.querySelector('[aria-label="total, 1 references"]');
  const resultToggle = (label: string, expanded: boolean) =>
    host.querySelector<HTMLButtonElement>(
      `.nb-output-section button[aria-label="${label}"][aria-expanded="${expanded}"]`,
    );
  const reopen = async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(true);
  };
  try {
    await render(false);
    const addPython = button("Python");
    assert(addPython);
    await act(async () => addPython.click());
    const editor = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Type Python or use AI..."]',
    );
    assert(editor);
    expect(result()).toBeNull();
    expect(editor.getAttribute("aria-label")).toBe("Edit Code 2");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    assert(setValue);
    await act(async () => {
      setValue.call(editor, source);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const run = button("Run Code 2");
    assert(run);
    await act(async () => run.click());
    expect(onSave).toHaveBeenCalledWith(
      "code",
      expect.objectContaining({ source }),
    );
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      start.mock.invocationCallOrder[0] ?? 0,
    );
    expect(start).toHaveBeenCalledWith({ cellId: "code" });
    const assertOutput = () => {
      const output = result();
      assert(output);
      expect(
        output
          .closest(".nb-output-section")
          ?.querySelector(".nb-output-header"),
      ).toBeNull();
      const source = host.querySelector('[aria-label="Edit Code 2"]');
      assert(source);
      expect(
        source.compareDocumentPosition(output) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const value = output.textContent ?? "";
      expect(value).toContain("before display");
      expect(
        Array.from(output.querySelectorAll("td"), (cell) => cell.textContent),
      ).toContain("126");
      expect(value).toContain("127");
      expect(value.indexOf("before display")).toBeLessThan(
        value.indexOf("126"),
      );
      expect(value.indexOf("126")).toBeLessThan(value.indexOf("127"));
      expect(output.querySelector('[aria-label="Copy output"]')).not.toBeNull();
      expect(exports()).not.toBeNull();
    };
    assertOutput();
    const runAll = button("Run all");
    assert(runAll);
    await act(async () => runAll.click());
    expect(start).toHaveBeenNthCalledWith(2, { all: true });
    expect(start).toHaveBeenCalledTimes(2);
    const collapse = resultToggle("Collapse", true);
    assert(collapse);
    await act(async () => collapse.click());
    expect(window.localStorage.getItem(collapseKey)).toBe("true");
    expect(result()).toBeNull();
    expect(exports()).not.toBeNull();
    await reopen();
    expect(result()).toBeNull();
    const expand = resultToggle("Expand", false);
    assert(expand);
    const placeholder = button("Result collapsed");
    assert(placeholder);
    await act(async () => placeholder.click());
    expect(window.localStorage.getItem(collapseKey)).toBe("false");
    await reopen();
    assertOutput();
    expect(start).toHaveBeenCalledTimes(2);
    const variables = button("Variables");
    assert(variables);
    await act(async () => variables.click());
    const panel = host.querySelector('aside[aria-label="Variables"]');
    assert(panel);
    expect(panel.textContent).toContain("Variables currently in kernel scope.");
    expect(panel.textContent).toContain("totalint126");
    expect(panel.textContent).not.toContain("pd");
  } finally {
    await act(async () => root.unmount());
    window.localStorage.removeItem(collapseKey);
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps stdout before the selectable traceback and repair affordance", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const selectLine = vi.fn();
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <PythonCellOutput
            projectId="project"
            cellId="code"
            canRepair
            outputs={[
              {
                kind: "stream",
                channel: "stdout",
                text: "before missing producer",
              },
              {
                kind: "error",
                trace: "NameError: name 'total' is not defined",
                line: 2,
              },
            ]}
            onSelectLine={selectLine}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const stdout = host.querySelector(".nb-python-stream");
    const traceback = host.querySelector('[role="alert"] pre');
    const repair = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Fix with agent",
    );
    assert(stdout && traceback && repair);
    expect(stdout.textContent).toContain("before missing producer");
    expect(traceback.textContent).toContain(
      "NameError: name 'total' is not defined",
    );
    expect(
      stdout.compareDocumentPosition(traceback) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      traceback.compareDocumentPosition(repair) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const line = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Line 2",
    );
    assert(line);
    await act(async () => line.click());
    expect(selectLine).toHaveBeenCalledWith(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

const failedSource =
  'print("before error")\nimport json\njson.loads("{bad json")';
const trace = [
  "Traceback (most recent call last)",
  "  File <cell>:3",
  '----> 3 json.loads("{bad json")',
  "  File /lib/python314.zip/json/decoder.py:353",
  "JSONDecodeError: Expecting property name enclosed in double quotes",
].join("\n");
const failure: NonNullable<NotebookOutputs[string]> = {
  status: "error",
  pythonOutputs: [
    { kind: "stream", channel: "stdout", text: "before error\n" },
    {
      kind: "error",
      trace,
      line: 3,
      exceptionName: "JSONDecodeError",
      exceptionMessage: "Expecting property name enclosed in double quotes",
    },
  ],
};

it("renders one exception alert and copies the plain traceback", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <PythonCellOutput
            projectId="project"
            cellId="code"
            canRepair
            outputs={failure.pythonOutputs ?? []}
            onSelectLine={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.querySelector("strong")?.textContent).toBe("JSONDecodeError");
    expect(alert?.querySelector("pre")?.textContent).toBe(trace);
    const copy = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy error",
    );
    assert(copy);
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledExactlyOnceWith(trace);
  } finally {
    await act(async () => root.unmount());
    writeText.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("sends one repair request and acknowledges delivery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  let confirmDelivery: (value: { delivered: boolean }) => void = () => {};
  sendToAgent.mockReturnValue(
    new Promise<{ delivered: boolean }>((resolve) => {
      confirmDelivery = resolve;
    }),
  );
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <PythonCellOutput
            projectId="project"
            cellId="code"
            canRepair
            outputs={failure.pythonOutputs ?? []}
            onSelectLine={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    const repair = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Fix with agent",
    );
    assert(repair);
    await act(async () => {
      repair.click();
      repair.click();
    });
    expect(sendToAgent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        submit: true,
        context: JSON.stringify({
          projectId: "project",
          cellId: "code",
          traceback: trace,
        }),
      }),
    );
    expect(repair.disabled).toBe(true);
    await act(async () => confirmDelivery({ delivered: true }));
    expect(repair.textContent).toBe("Sent to agent");
    expect(repair.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    sendToAgent.mockReset();
    vi.unstubAllGlobals();
  }
});

it("clears old traceback targeting on edit and replaces the alert on retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const button = (name: string) =>
    [...host.querySelectorAll("button")].find(
      (item) =>
        item.textContent === name || item.getAttribute("aria-label") === name,
    );
  const recoveredSource = 'print("recovered")';
  function Harness() {
    const [draft, setDraft] = useState(failedSource);
    const [accepted, setAccepted] = useState(failedSource);
    const [output, setOutput] = useState(failure);
    return (
      <NotebookCell
        cell={{
          ...python,
          contents: { ...python.contents, source: accepted },
        }}
        title="Code 1"
        connections={[]}
        canEdit
        canRun
        busy={false}
        running={false}
        saving={false}
        deleting={false}
        connectionPending={false}
        connectionId={null}
        draftText={draft}
        dirty={draft !== accepted}
        stale={false}
        outputState={output}
        error={null}
        onTextChange={setDraft}
        onSaveDraft={() => {}}
        onRun={() => {
          expect(draft).toBe(recoveredSource);
          setAccepted(draft);
          setOutput({
            status: "complete",
            pythonOutputs: [
              { kind: "stream", channel: "stdout", text: "recovered\n" },
            ],
          });
        }}
        onDiscard={() => {}}
        onOverwrite={() => {}}
        onDelete={() => {}}
        onSelectConnection={() => {}}
        onDismissError={() => {}}
        onRetryError={() => {}}
      />
    );
  }
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <Harness />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(button("Line 3")).toBeDefined();
    expect(button("Run Code 1")?.hasAttribute("data-failed")).toBe(true);
    const editor = host.querySelector("textarea");
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    assert(editor && setValue);
    await act(async () => {
      setValue.call(editor, recoveredSource);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button("Line 3")).toBeUndefined();
    expect(button("Fix with agent")?.disabled).toBe(true);
    const staleRun = button("Run Code 1 · Stale output");
    assert(staleRun);
    expect(staleRun.hasAttribute("data-failed")).toBe(false);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "JSONDecodeError",
    );
    await act(async () => staleRun.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(
      host.querySelector('[aria-label="Python output"]')?.textContent,
    ).toContain("recovered");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("shows the legacy interruption trace and prior stdout without offering repair", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <PythonCellOutput
            projectId="project"
            cellId="code"
            canRepair
            outputs={[
              { kind: "stream", channel: "stdout", text: "tick 1\n" },
              {
                kind: "error",
                line: null,
                trace: "Traceback (most recent call last):\nKeyboardInterrupt",
              },
            ]}
            onSelectLine={vi.fn()}
          />
        </AgentNativeI18nProvider>,
      ),
    );
    expect(host.textContent).toContain("tick 1");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "KeyboardInterrupt",
    );
    expect(host.textContent).not.toContain("Fix with agent");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

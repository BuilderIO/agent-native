// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { EditorView } from "@uiw/react-codemirror";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import { runReceiptSchema } from "../../../shared/notebook-execution";
import { NotebookCell } from "./NotebookCell";
import { NotebookRunControls } from "./NotebookRunControls";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(content: ReactNode) {
  return act(async () =>
    root.render(
      <AgentNativeI18nProvider
        catalog={{ messages: enUS }}
        persistPreference={false}
      >
        {content}
      </AgentNativeI18nProvider>,
    ),
  );
}

function press(target: Element, key: string, options?: KeyboardEventInit) {
  return act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

const sqlCell = {
  id: "cell-sql",
  projectId: "project",
  versionId: "version",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  contents: {
    id: "cell-sql",
    order: "a",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    kind: "sql",
    source: "SELECT 1; SELECT 42",
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  },
} satisfies Cell;

const cellProps: ComponentProps<typeof NotebookCell> = {
  cell: sqlCell,
  title: "SQL 1",
  connections: [],
  canEdit: true,
  busy: false,
  running: false,
  saving: false,
  deleting: false,
  connectionPending: false,
  connectionId: null,
  draftText: "SELECT 1; SELECT 42",
  dirty: false,
  stale: false,
  outputState: undefined,
  error: null,
  onTextChange: () => {},
  onSaveDraft: () => {},
  onRun: () => {},
  onDiscard: () => {},
  onOverwrite: () => {},
  onDelete: () => {},
  onSelectConnection: () => {},
  onDismissError: () => {},
  onRetryError: () => {},
};

it("runs each menu mode once and leaves the project default and exact tooltip intact", async () => {
  const onRun = vi.fn();
  await render(
    <NotebookCell {...cellProps} onRun={onRun} runMode="upstream" />,
  );
  const menuTrigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Run mode"]',
  );
  const run = host.querySelector<HTMLButtonElement>(
    'button[data-rid="notebook.cell.run"]',
  );
  assert(menuTrigger && run);
  expect(run.getAttribute("aria-description")).toBe(
    "Run selected cell + all linked precedent cells",
  );

  const items = [
    [
      "Auto",
      "⌘⇧A",
      "Run selected cell + all descendent and stale cells",
      "auto",
    ],
    [
      "Cell + upstream",
      "⌘⇧S",
      "Run selected cell + all linked precedent cells",
      "upstream",
    ],
    ["Cell only", "⌘⇧D", "Run selected cell", "cell-only"],
    [
      "Cell + downstream",
      "",
      "Run selected cell + all linked descendent cells",
      "downstream",
    ],
  ] as const;
  for (const [label, shortcut, tooltip, mode] of items) {
    await press(menuTrigger, "Enter");
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((entry) => entry.getAttribute("aria-label") === label);
    assert(item, label);
    expect(item.getAttribute("aria-label")).toBe(label);
    expect(item.getAttribute("aria-description")).toBe(tooltip);
    expect(item.textContent).toBe(label + tooltip + shortcut);
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "RUN STATS",
    );
    await act(async () => item.click());
    expect(onRun).toHaveBeenLastCalledWith(mode, undefined);
    expect(run.getAttribute("aria-description")).toBe(
      "Run selected cell + all linked precedent cells",
    );
  }
  await act(async () => run.click());
  expect(onRun.mock.calls).toHaveLength(5);
  expect(onRun).toHaveBeenLastCalledWith(undefined, undefined);
});

it("binds editor shortcuts to one-off modes and runs only the selected SQL with cache bypass", async () => {
  const onRun = vi.fn();
  await render(<NotebookCell {...cellProps} onRun={onRun} />);
  const editor = host.querySelector<HTMLElement>(".cm-content");
  assert(editor);
  await press(editor, "A", { metaKey: true, shiftKey: true });
  await press(editor, "S", { ctrlKey: true, shiftKey: true });
  await press(editor, "D", { metaKey: true, shiftKey: true });
  expect(onRun.mock.calls).toEqual([
    ["auto", undefined],
    ["upstream", undefined],
    ["cell-only", undefined],
  ]);
  await press(editor, "D", {
    metaKey: true,
    shiftKey: true,
    isComposing: true,
  });
  expect(onRun).toHaveBeenCalledTimes(3);
  const view = EditorView.findFromDOM(editor);
  assert(view);
  await act(async () => view.dispatch({ selection: { anchor: 10, head: 19 } }));
  await press(editor, "Enter", { metaKey: true, shiftKey: true });
  expect(onRun).toHaveBeenLastCalledWith("cell-only", {
    selection: { from: 10, to: 19 },
    bypassCache: true,
  });
});

it("retains stale output and clears just the blocked descendant output and run chip", async () => {
  const outputState = {
    ranAt: "2026-11-19T08:59:30Z",
    output: { type: "text", text: "Prior descendant value" } as const,
  };
  const independentOutput = {
    ranAt: outputState.ranAt,
    output: { type: "text", text: "Independent value" } as const,
  };
  const run = runFixture();
  const blocked = run.attempts.find(
    ({ state }) => state.status === "blocked",
  )?.state;
  assert(blocked);
  const cells = (failed: boolean) => (
    <>
      <NotebookCell
        {...cellProps}
        dirty
        outputState={outputState}
        runState={failed ? blocked : undefined}
      />
      <NotebookCell
        {...cellProps}
        cell={{ ...sqlCell, id: "independent" }}
        outputState={independentOutput}
      />
    </>
  );
  await render(cells(false));
  const dependent = host.querySelector('[data-notebook-cell="cell-sql"]');
  const independent = host.querySelector('[data-notebook-cell="independent"]');
  const button = dependent?.querySelector('[data-rid="notebook.cell.run"]');
  assert(dependent && button && independent);
  expect(button.getAttribute("aria-label")).toBe("Run SQL 1 · Stale output");
  expect(button.hasAttribute("data-stale")).toBe(true);
  expect(dependent.textContent).toContain("Prior descendant value");
  expect(dependent.querySelector("time")).not.toBeNull();

  await render(cells(true));
  expect(button.hasAttribute("data-blocked")).toBe(true);
  const message =
    "This cell was cancelled because an upstream cell encountered an error.";
  expect(button.getAttribute("aria-description")).toBe(message);
  expect(dependent.textContent).toContain(message);
  expect(dependent.textContent).not.toContain("Prior descendant value");
  expect(dependent.querySelector("time")).toBeNull();
  expect(independent.textContent).toContain("Independent value");
  expect(independent.querySelector("time")).not.toBeNull();
});

it("exposes Restart and run all by name with a separate keyboard shortcut", async () => {
  const onRunAll = vi.fn();
  await render(
    <NotebookRunControls
      canRun
      busy={false}
      run={null}
      pending={false}
      stopping={false}
      defaultMode="auto"
      onRunAll={onRunAll}
      onInterrupt={() => {}}
      onClearOutputs={() => {}}
      onDefaultModeChange={() => {}}
    />,
  );
  const trigger = host.querySelector('button[aria-label="Run all options"]');
  assert(trigger);
  await press(trigger, "Enter");
  const item = document.querySelector<HTMLElement>(
    '[role="menuitem"][aria-label="Restart and run all"]',
  );
  assert(item);
  expect(item.getAttribute("aria-keyshortcuts")).toBe("Alt+R");
  expect(item.textContent).toContain("⌥R");
  await act(async () => item.click());
  expect(onRunAll).toHaveBeenCalledExactlyOnceWith({ restart: true });
});

it("shows elapsed time and durable progress only for an active receipt and interrupts the run", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-19T09:00:03Z"));
  const interrupt = vi.fn();
  const onStop = vi.fn();
  const onRunAll = vi.fn();
  const running = runFixture();
  const controls = (run: typeof running | null, pending = false) => (
    <NotebookRunControls
      canRun
      busy={run !== null || pending}
      run={run}
      pending={pending}
      stopping={false}
      defaultMode="auto"
      onRunAll={onRunAll}
      onInterrupt={interrupt}
      onStop={onStop}
      onClearOutputs={() => {}}
      onDefaultModeChange={() => {}}
    />
  );
  await render(controls(null));
  expect(host.textContent).not.toContain("Running for");
  const runAll = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Run all",
  );
  assert(runAll);
  expect(runAll.title).toBe("Add cell");
  await act(async () => runAll.click());
  expect(onRunAll).toHaveBeenCalledExactlyOnceWith({});
  await render(controls(null, true));
  expect(host.textContent).not.toContain("Running for");

  vi.setSystemTime(new Date("2026-11-19T09:00:07Z"));
  await render(controls(running));
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "Running for 7s · 2 / 3 cells complete",
  );
  await act(async () => vi.advanceTimersByTime(1_000));
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "Running for 8s · 2 / 3 cells complete",
  );
  const stop = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Interrupt",
  );
  assert(stop);
  await act(async () => stop.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "Interrupt cell execution while maintaining the kernel state.",
  );
  await act(async () => stop.click());
  expect(interrupt).toHaveBeenCalledExactlyOnceWith();
  expect(onRunAll).toHaveBeenCalledTimes(1);
  const runOptions = host.querySelector('button[aria-label="Run all options"]');
  assert(runOptions);
  await press(runOptions, "Enter");
  const stopOption = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "Stop");
  assert(stopOption);
  await act(async () => stopOption.click());
  expect(onStop).toHaveBeenCalledExactlyOnceWith();

  await render(
    controls({
      ...running,
      attempts: running.attempts.map((receipt) =>
        receipt.state.status === "running"
          ? {
              ...receipt,
              state: { status: "complete", resultIds: [] },
            }
          : receipt,
      ),
    }),
  );
  expect(host.textContent).not.toContain("Running for");
});

it("explains that a browser interrupt restarts Python and requires rerunning cells", async () => {
  await render(
    <NotebookRunControls
      canRun
      busy
      browserRunning
      run={null}
      pending={false}
      stopping={false}
      defaultMode="auto"
      onRunAll={() => {}}
      onInterrupt={() => {}}
      onClearOutputs={() => {}}
      onDefaultModeChange={() => {}}
    />,
  );
  const interrupt = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Interrupt",
  );
  assert(interrupt);
  await act(async () => interrupt.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "Interrupt cell execution. Stopping browser Python restarts its session. Rerun cells to restore variables.",
  );
});

function runFixture() {
  return runReceiptSchema.parse({
    status: "admitted",
    runId: "run",
    request: {
      requestId: "request",
      snapshot: {
        ref: {
          workspaceId: "workspace",
          projectId: "project",
          head: { versionId: "version", revision: "3" },
          eventSeq: "4",
        },
        namespace: { kind: "draft", namespaceId: "namespace" },
        inputRevision: "0",
        executionFingerprint: "fingerprint",
      },
      mode: "run-all",
      restart: false,
      cache: "reuse",
    },
    startedAt: "2026-11-19T09:00:00Z",
    plan: {
      admittedCellIds: ["producer", "dependent", "independent"],
      dependencyResultIds: [],
      rejectedCells: [],
    },
    attempts: [
      ["producer", { status: "failed", reason: "execution_failed" }],
      [
        "dependent",
        {
          status: "blocked",
          reason: "cancelled_upstream",
          blockedBy: "producer",
        },
      ],
      ["independent", { status: "running" }],
    ].map(([cellId, state]) => ({
      attempt: {
        namespaceId: "namespace",
        cellId,
        runId: "run",
        attemptId: `attempt-${cellId}`,
        outputGeneration: `fence-${cellId}`,
      },
      state,
    })),
    cursor: "5",
  });
}

it.each(["SQL", "Python"] as const)(
  "shows a plain run control for a never-run %s cell, even with unsaved edits",
  async (kind) => {
    const cell: Cell =
      kind === "SQL"
        ? sqlCell
        : {
            ...sqlCell,
            contents: {
              ...sqlCell.contents,
              kind: "code",
              language: "python",
              source: "print(42)",
            },
          };
    await render(
      <NotebookCell {...cellProps} cell={cell} title={kind + " 1"} dirty />,
    );
    const run = host.querySelector('[data-rid="notebook.cell.run"]');
    assert(run);
    expect(run.getAttribute("aria-label")).toBe("Run " + kind + " 1");
    expect(run.hasAttribute("data-stale")).toBe(false);
  },
);

it("shows the error run hint after failure and the stale hint after the source changes", async () => {
  const outputState = { status: "error", error: "Query failed" } as const;
  const cell = (dirty: boolean) => (
    <NotebookCell {...cellProps} dirty={dirty} outputState={outputState} />
  );
  await render(cell(false));
  const run = host.querySelector<HTMLButtonElement>(
    '[data-rid="notebook.cell.run"]',
  );
  assert(run);
  expect(run.getAttribute("aria-label")).toBe("Run SQL 1");
  expect(run.getAttribute("aria-description")).toBe(
    "This cell encountered an error.",
  );
  expect(run.hasAttribute("data-failed")).toBe(true);
  expect(run.hasAttribute("data-stale")).toBe(false);
  await act(async () => run.focus());
  const tooltip = document.querySelector('[role="tooltip"]');
  assert(tooltip);
  expect(tooltip.textContent).toContain("This cell encountered an error.");
  expect(tooltip.textContent).toContain(
    "Run selected cell + all descendent and stale cells",
  );

  await render(cell(true));
  expect(run.getAttribute("aria-label")).toBe("Run SQL 1 · Stale output");
  expect(run.hasAttribute("data-failed")).toBe(false);
  expect(run.hasAttribute("data-stale")).toBe(true);
});

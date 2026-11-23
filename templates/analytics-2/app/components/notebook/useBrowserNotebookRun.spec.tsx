// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import type { Cell } from "@/lib/model/contracts";

import {
  cellRunReceiptSchema,
  executionSnapshotSchema,
  runRequestSchema,
} from "../../../shared/notebook-execution";
import { useBrowserNotebookRun } from "./useBrowserNotebookRun";

const { callAction, longSource, live } = vi.hoisted(() => ({
  callAction: vi.fn(),
  longSource: "print(seed)\n# hold execution open",
  live: { started: () => {}, finish: () => {} },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  actionErrorCode: (error: { errorCode?: string }) => error.errorCode,
}));

vi.mock("@/lib/notebook-kernel/browser-kernel", () => ({
  BrowserNotebookKernel: class {
    usable = true;
    private seed: number | undefined;
    private abort: (() => void) | undefined;

    async initialize() {}

    async execute(
      _snapshot: unknown,
      _runId: string,
      command: { operation: string; source: string },
      emitArtifacts: unknown,
      receive: (output: { event: { event: unknown } }) => void,
    ) {
      expect(emitArtifacts).toBeInstanceOf(Map);
      const stream = (text: string) =>
        receive({
          event: { event: { type: "stream", channel: "stdout", text } },
        });
      const fail = (trace: string) => {
        receive({
          event: {
            event: {
              type: "error",
              trace,
              line: null,
              reason: "execution_failed",
            },
          },
        });
        receive({
          event: {
            event: {
              type: "terminal",
              outcome: { status: "failed", reason: "execution_failed" },
            },
          },
        });
      };
      if (command.operation === "execute-dataframe-sql") {
        if (command.source.includes("missing_frame")) {
          fail("Table with name missing_frame does not exist");
          return;
        }
        receive({
          event: {
            event: { type: "terminal", outcome: { status: "complete" } },
          },
        });
        return;
      }
      if (command.source === "seed = 42") {
        this.seed = 42;
        stream("upstream ready\n");
      } else if (command.source === 'print("later")') {
        stream("later\n");
      } else if (
        command.source === longSource ||
        command.source === "print(seed)"
      ) {
        if (this.seed === undefined) {
          fail("NameError: name 'seed' is not defined");
          return;
        }
        if (command.source === longSource) {
          stream("tick 0\n");
          stream("tick 1\n");
          await new Promise<void>((resolve, reject) => {
            this.abort = () =>
              reject(new DOMException("Browser kernel stopped", "AbortError"));
            live.finish = resolve;
            live.started();
          });
        }
        stream(`${this.seed}\n`);
      } else {
        stream("hi\n");
      }
      receive({
        event: { event: { type: "terminal", outcome: { status: "complete" } } },
      });
    }

    close() {
      this.usable = false;
      this.abort?.();
    }
  },
}));

type Execution = NonNullable<Parameters<typeof useBrowserNotebookRun>[1]>;
const contents: Extract<Cell["contents"], { kind: "code" }> = {
  id: "python",
  order: "a1",
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
  outputResult: true,
  kind: "code",
  source: "",
  language: "python",
  resultVariable: null,
};
const outputGeneration = "6679f22f-10f2-4dad-9f88-4e1c225a14ba";

function execution(eventSeq: string, source: string): Execution {
  return {
    status: "found",
    snapshot: executionSnapshotSchema.parse({
      ref: {
        workspaceId: "workspace",
        projectId: "project",
        head: { versionId: "draft", revision: eventSeq },
        eventSeq,
      },
      namespace: { kind: "draft", namespaceId: "notebook" },
      inputRevision: "0",
      executionFingerprint: source,
    }),
    activeRunIds: [],
    reactivePending: false,
    autoRerun: true,
    defaultMode: "auto",
    settingsRevision: "0" as Execution["settingsRevision"],
    cells: {},
    browserCells: [
      {
        id: contents.id,
        contents: { ...contents, source },
        signature: source,
        dependencies: [],
      },
    ],
  };
}

function dependentExecution(eventSeq: string, source: string): Execution {
  const accepted = execution(eventSeq, source);
  return {
    ...accepted,
    browserCells: [
      {
        id: "seed",
        contents: { ...contents, id: "seed", source: "seed = 42" },
        signature: "seed = 42",
        dependencies: [],
      },
      {
        id: contents.id,
        contents: { ...contents, source },
        signature: source,
        dependencies: [{ name: "seed", cellId: "seed", kind: "result" }],
      },
      {
        id: "later",
        contents: { ...contents, id: "later", source: 'print("later")' },
        signature: "later",
        dependencies: [{ name: "python", cellId: contents.id, kind: "result" }],
      },
    ],
  };
}

function runRequest(
  accepted: Execution,
  mode: "run-all" | "cell-only" | "downstream" | "auto" | "run-section",
  targetCellId = contents.id,
) {
  return runRequestSchema.parse({
    requestId: "run",
    snapshot: accepted.snapshot,
    cache: "reuse",
    mode,
    ...(mode === "run-all"
      ? { restart: false }
      : { targetCellId, staleValues: "allow-compatible" }),
  });
}

function mountRun(accepted: Execution) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let admissions = 0;
  callAction.mockImplementation(async (name: string) => {
    if (name === "admit-browser-notebook-run") {
      admissions += 1;
      return {
        status: "admitted",
        runId: `browser-run-${admissions}`,
        attemptId: `attempt-${admissions}`,
        outputGeneration: crypto.randomUUID(),
      };
    }
    if (name === "complete-browser-notebook-run") return { status: "saved" };
    if (name === "cancel-notebook-run") return { status: "cancelled" };
    throw new Error(name);
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  let latest: ReturnType<typeof useBrowserNotebookRun> | undefined;
  function Notebook({ snapshot }: { snapshot: Execution }) {
    latest = useBrowserNotebookRun("project:draft", snapshot);
    return (
      <output>
        {latest.outputs[contents.id]?.pythonOutputs?.map((item) =>
          item.kind === "stream" ? item.text : null,
        )}
      </output>
    );
  }
  const render = (snapshot = accepted) =>
    act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <Notebook snapshot={snapshot} />
        </AgentNativeI18nProvider>,
      );
    });
  function browser() {
    if (!latest) throw new Error("Notebook is not mounted");
    return latest;
  }
  async function startLong(
    snapshot: Execution,
    mode: "cell-only" | "downstream" | "run-section",
    targetCellId?: string,
  ) {
    const started = new Promise<void>((resolve) => {
      live.started = resolve;
    });
    let running: Promise<boolean | null> = Promise.resolve(null);
    await act(async () => {
      running = browser().start(
        snapshot,
        runRequest(snapshot, mode, targetCellId),
      );
      await Promise.race([started, running]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
    return { finished: running };
  }
  async function unmount() {
    await act(async () => root.unmount());
    callAction.mockReset();
    vi.unstubAllGlobals();
  }
  return { browser, render, startLong, unmount, host };
}

it("keeps completed output fresh while the notebook still displays an older execution snapshot", async () => {
  callAction.mockImplementation(async (name: string) => {
    if (name === "admit-browser-notebook-run")
      return {
        status: "admitted",
        runId: "browser-run",
        attemptId: "attempt",
        outputGeneration,
      };
    if (name === "complete-browser-notebook-run") return { status: "saved" };
    throw new Error(name);
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const older = execution("1", 'print("old")');
  const accepted = execution("2", 'print("hi")');
  const edited = execution("3", 'print("new edit")');
  let browser: ReturnType<typeof useBrowserNotebookRun> | undefined;

  function Notebook({ snapshot }: { snapshot: Execution }) {
    browser = useBrowserNotebookRun("project:draft", snapshot);
    const output = browser.outputs[contents.id];
    return (
      <output
        aria-label={browser.stale.has(contents.id) ? "Stale output" : "Output"}
      >
        {output?.pythonOutputs?.map((item) =>
          item.kind === "stream" ? item.text : null,
        )}
      </output>
    );
  }

  const render = (snapshot: Execution) =>
    act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <Notebook snapshot={snapshot} />
        </AgentNativeI18nProvider>,
      );
    });
  try {
    await render(older);
    const start = browser?.start;
    expect(start).toBeDefined();
    await act(async () => {
      await start?.(
        accepted,
        runRequestSchema.parse({
          requestId: "run",
          snapshot: accepted.snapshot,
          mode: "cell-only",
          targetCellId: contents.id,
          staleValues: "allow-compatible",
          cache: "reuse",
        }),
      );
    });
    expect(host.querySelector("output")?.textContent).toBe("hi\n");
    expect(callAction.mock.calls.map(([name]) => name)).toEqual([
      "admit-browser-notebook-run",
      "complete-browser-notebook-run",
    ]);
    expect(callAction.mock.calls[0]?.[1]).toMatchObject({
      snapshot: accepted.snapshot,
      cellId: contents.id,
    });
    expect(callAction.mock.calls[1]?.[1]).toEqual({
      runId: "browser-run",
      attemptId: "attempt",
      outcome: "complete",
      events: [{ type: "stream", channel: "stdout", text: "hi\n" }],
    });
    expect(host.querySelector("output")?.getAttribute("aria-label")).toBe(
      "Output",
    );
    await render(accepted);
    expect(host.querySelector("output")?.getAttribute("aria-label")).toBe(
      "Output",
    );
    await render(edited);
    expect(host.querySelector("output")?.getAttribute("aria-label")).toBe(
      "Stale output",
    );
    await render({
      ...edited,
      cells: {
        [contents.id]: {
          stale: true,
          resultId: null,
          finishedAt: null,
          attempt: cellRunReceiptSchema.parse({
            attempt: {
              namespaceId: "notebook",
              runId: "browser-run",
              attemptId: "attempt",
              outputGeneration,
              cellId: contents.id,
            },
            state: { status: "complete", resultIds: [] },
          }),
        },
      },
    });
    expect(host.querySelector("output")?.textContent).toBe("");
  } finally {
    await act(async () => root.unmount());
    callAction.mockReset();
    vi.unstubAllGlobals();
  }
});

it("exposes a worker SQL failure through the visible cell error path after Run all", async () => {
  callAction.mockImplementation(async (name: string) => {
    if (name === "admit-browser-notebook-run")
      return {
        status: "admitted",
        runId: "browser-run",
        attemptId: "attempt",
        outputGeneration: "1",
      };
    if (name === "complete-browser-notebook-run") return { status: "saved" };
    throw new Error(name);
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const accepted = execution("1", 'print("hi")');
  accepted.browserCells?.push({
    id: "sql",
    contents: {
      ...contents,
      id: "sql",
      kind: "sql",
      source: "SELECT * FROM missing_frame",
      connectionMode: "dataframes",
      dataConnectionId: null,
      databaseSchema: null,
    },
    signature: "sql",
    dependencies: [],
  });
  const mounted: { browser?: ReturnType<typeof useBrowserNotebookRun> } = {};
  function Notebook() {
    mounted.browser = useBrowserNotebookRun("project:draft", accepted);
    return null;
  }
  try {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <Notebook />
        </AgentNativeI18nProvider>,
      );
    });
    await act(async () => {
      await mounted.browser?.start(
        accepted,
        runRequestSchema.parse({
          requestId: "run",
          snapshot: accepted.snapshot,
          mode: "run-all",
          restart: false,
          cache: "reuse",
        }),
      );
    });
    expect(mounted.browser?.outputs.sql).toMatchObject({
      status: "error",
      error: "Table with name missing_frame does not exist",
    });
    expect(mounted.browser?.outputs.sql?.pythonOutputs).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    callAction.mockReset();
    vi.unstubAllGlobals();
  }
});

it("surfaces unavailable result storage and lets the next Python run save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const accepted = execution("1", 'print("hi")');
  const mounted: { browser?: ReturnType<typeof useBrowserNotebookRun> } = {};
  let saved = false;
  callAction.mockImplementation(async (name: string) => {
    if (name === "admit-browser-notebook-run")
      return {
        status: "admitted",
        runId: "browser-run",
        attemptId: "attempt",
        outputGeneration: "1",
      };
    if (name === "complete-browser-notebook-run" && saved)
      return { status: "saved" };
    if (name === "complete-browser-notebook-run")
      throw Object.assign(new Error("Storage unavailable"), {
        errorCode: "notebook_result_storage_unavailable",
      });
    if (name === "cancel-notebook-run") return { status: "cancelled" };
    throw new Error(name);
  });
  function Notebook() {
    mounted.browser = useBrowserNotebookRun("project:draft", accepted);
    return <output>{mounted.browser.outputs[contents.id]?.error}</output>;
  }
  const run = () =>
    act(async () => {
      await mounted.browser?.start(
        accepted,
        runRequestSchema.parse({
          requestId: "run",
          snapshot: accepted.snapshot,
          mode: "cell-only",
          targetCellId: contents.id,
          staleValues: "allow-compatible",
          cache: "reuse",
        }),
      );
    });
  try {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={{ messages: enUS }}>
          <Notebook />
        </AgentNativeI18nProvider>,
      );
    });
    await run();
    expect(host.textContent).toBe(enUS.queryError.resultStorageUnavailable);
    saved = true;
    await run();
    expect(host.textContent).toBe("");
    expect(mounted.browser?.outputs[contents.id]?.status).toBe("complete");
  } finally {
    await act(async () => root.unmount());
    callAction.mockReset();
    vi.unstubAllGlobals();
  }
});

it("shows stdout in the cell while the browser worker is still running", async () => {
  const initial = dependentExecution("1", "print(seed)");
  const accepted = dependentExecution("2", longSource);
  const { browser, host, render, startLong, unmount } = mountRun(initial);
  try {
    await render();
    await act(async () => {
      await browser().start(initial, runRequest(initial, "run-all"));
    });
    callAction.mockClear();
    await render(accepted);
    const { finished } = await startLong(accepted, "cell-only");
    try {
      expect(browser().active.has(contents.id)).toBe(true);
      expect(host.querySelector("output")?.textContent).toBe(
        "tick 0\ntick 1\n",
      );
      expect(callAction.mock.calls.map(([name]) => name)).toEqual([
        "admit-browser-notebook-run",
      ]);
    } finally {
      await act(async () => {
        live.finish();
        await finished;
      });
    }
    expect(host.querySelector("output")?.textContent).toBe(
      "tick 0\ntick 1\n42\n",
    );
    expect(callAction.mock.calls[1]?.slice(0, 2)).toEqual([
      "complete-browser-notebook-run",
      {
        runId: "browser-run-4",
        attemptId: "attempt-4",
        outcome: "complete",
        events: [
          { type: "stream", channel: "stdout", text: "tick 0\ntick 1\n42\n" },
        ],
      },
    ]);
  } finally {
    await unmount();
  }
});

it("keeps prior cells and partial stdout on Stop and recovers the restarted Python namespace on Auto", async () => {
  const initial = dependentExecution("1", "print(seed)");
  const accepted = dependentExecution("2", longSource);
  const { browser, render, startLong, unmount } = mountRun(initial);
  try {
    await render();
    await act(async () => {
      await browser().start(initial, runRequest(initial, "run-all"));
    });
    const { seed, later } = browser().outputs;
    expect(seed?.status).toBe("complete");
    expect(later?.status).toBe("complete");
    await render(accepted);
    callAction.mockClear().mockResolvedValueOnce({
      status: "admitted",
      runId: "stopped-browser-run",
      attemptId: "stopped-attempt",
      outputGeneration,
    });
    const { finished } = await startLong(accepted, "downstream");
    expect(browser().active.has("later")).toBe(true);
    await act(async () => {
      await browser().cancel();
      await finished;
    });
    expect(browser().active.size).toBe(0);
    expect(browser().outputs.seed).toEqual(seed);
    expect(browser().outputs.later).toEqual(later);
    expect(browser().outputs[contents.id]).toMatchObject({
      status: "cancelled",
      error:
        "Execution interrupted. The Python session was restarted. Rerun the cells that define your variables.",
      pythonOutputs: [
        { kind: "stream", channel: "stdout", text: "tick 0\ntick 1\n" },
      ],
    });
    expect(callAction.mock.calls.map(([name]) => name)).toEqual([
      "admit-browser-notebook-run",
      "cancel-notebook-run",
    ]);
    expect(callAction.mock.calls[1]?.[1]).toEqual({
      runId: "stopped-browser-run",
    });

    const recovered = dependentExecution("3", "print(seed)");
    await render(recovered);
    await act(async () => {
      await browser().start(recovered, runRequest(recovered, "cell-only"));
    });
    expect(browser().outputs[contents.id]).toMatchObject({
      status: "error",
      error: "Run the upstream cell first.",
    });
    callAction.mockClear();
    await act(async () => {
      await browser().start(recovered, runRequest(recovered, "auto"));
    });
    expect(browser().outputs[contents.id]).toMatchObject({
      status: "complete",
      pythonOutputs: [{ kind: "stream", channel: "stdout", text: "42\n" }],
    });
    expect(
      callAction.mock.calls.flatMap(([name, input]) =>
        name === "admit-browser-notebook-run" ? [input.cellId] : [],
      ),
    ).toEqual(["seed", "python", "later"]);
  } finally {
    await unmount();
  }
});

it("cancels a browser run admitted after Stop without submitting any output", async () => {
  const accepted = execution("1", 'print("hi")');
  const { browser, render, unmount } = mountRun(accepted);
  const receipt = {
    status: "admitted",
    runId: "late-browser-run",
    attemptId: "late-attempt",
    outputGeneration,
  };
  let admit: () => void = () => {
    throw new Error("Expected admission to be in flight");
  };
  const admissionRequested = new Promise<void>((requested) => {
    callAction.mockImplementationOnce(
      (_name: string, _input: unknown, options: { signal?: AbortSignal }) =>
        new Promise<typeof receipt>((resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
          admit = () => resolve(receipt);
          requested();
        }),
    );
  });
  let running: Promise<boolean | null> = Promise.resolve(null);
  try {
    await render();
    await act(async () => {
      running = browser().start(accepted, runRequest(accepted, "cell-only"));
      await admissionRequested;
    });
    await act(async () => {
      await browser().cancel();
    });
    await act(async () => {
      admit();
      await running;
    });
    expect(browser().outputs[contents.id]?.status).toBe("cancelled");
    expect(callAction.mock.calls.map(([name]) => name)).toEqual([
      "admit-browser-notebook-run",
      "cancel-notebook-run",
    ]);
    expect(callAction.mock.calls[1]?.[1]).toEqual({
      runId: "late-browser-run",
    });
  } finally {
    await unmount();
  }
});

it("stops a collapsed nested section's browser run without replacing unrelated output", async () => {
  const draft = dependentExecution("1", longSource);
  const accepted = {
    ...draft,
    browserCells: draft.browserCells?.map((cell) =>
      cell.id === contents.id
        ? {
            ...cell,
            contents: { ...cell.contents, parentSectionId: "inner" },
          }
        : cell.id === "later"
          ? { ...cell, dependencies: [] }
          : cell,
    ),
    browserSections: [
      { id: "outer", contents: { kind: "collapsible", collapsed: true } },
      {
        id: "inner",
        contents: {
          kind: "collapsible",
          collapsed: true,
          parentSectionId: "outer",
        },
      },
    ],
  } satisfies Execution;
  const { browser, render, startLong, unmount } = mountRun(accepted);
  try {
    await render();
    await act(async () => {
      await browser().start(
        accepted,
        runRequest(accepted, "cell-only", "later"),
      );
    });
    const unrelated = browser().outputs.later;
    expect(unrelated).toMatchObject({ status: "complete" });
    const { finished } = await startLong(accepted, "run-section", "outer");
    try {
      expect([...browser().active]).toEqual([contents.id]);
      expect(browser().outputs.seed?.status).toBe("complete");
    } finally {
      await act(async () => {
        await browser().cancel();
      });
    }
    expect(await finished).toBe(false);
    expect(browser().active.size).toBe(0);
    expect(browser().outputs[contents.id]?.status).toBe("cancelled");
    expect(browser().outputs.later).toBe(unrelated);
  } finally {
    await unmount();
  }
});

it("admits and saves each Python cell selected by a section run in dependency order", async () => {
  const draft = dependentExecution("1", "print(seed)");
  const sectionId = "section";
  const accepted = {
    ...draft,
    browserCells: draft.browserCells?.map((cell) =>
      cell.id === contents.id
        ? {
            ...cell,
            contents: { ...cell.contents, parentSectionId: sectionId },
          }
        : cell,
    ),
    browserSections: [
      { id: sectionId, contents: { kind: "collapsible", collapsed: true } },
    ],
  } satisfies Execution;
  const { browser, render, unmount } = mountRun(accepted);
  try {
    await render();
    await act(async () => {
      expect(
        await browser().start(
          accepted,
          runRequest(accepted, "run-section", sectionId),
        ),
      ).toBe(true);
    });
    expect(
      callAction.mock.calls.map(([name, input]) => [name, input]),
    ).toMatchObject([
      [
        "admit-browser-notebook-run",
        { snapshot: accepted.snapshot, cellId: "seed" },
      ],
      [
        "complete-browser-notebook-run",
        { runId: "browser-run-1", attemptId: "attempt-1", outcome: "complete" },
      ],
      [
        "admit-browser-notebook-run",
        { snapshot: accepted.snapshot, cellId: contents.id },
      ],
      [
        "complete-browser-notebook-run",
        {
          runId: "browser-run-2",
          attemptId: "attempt-2",
          outcome: "complete",
          events: [{ type: "stream", channel: "stdout", text: "42\n" }],
        },
      ],
    ]);
  } finally {
    await unmount();
  }
});

it("lazily fetches warehouse results for downstream browser cells", async () => {
  const draft = execution("1", "select 1");
  const accepted: Execution = {
    ...draft,
    browserCells: [
      {
        id: "warehouse1",
        contents: {
          ...contents,
          id: "warehouse1",
          kind: "sql",
          source: "select 1 as a",
          dataConnectionId: "conn1",
          databaseSchema: null,
          parentSectionId: "section1",
        },
        signature: "select 1 as a",
        dependencies: [],
      },
      {
        id: "browser2",
        contents: {
          ...contents,
          id: "browser2",
          kind: "code",
          source: "print('hello')",
          parentSectionId: "section1",
        },
        signature: "print('hello')",
        dependencies: [],
      },
      {
        id: "browser1",
        contents: {
          ...contents,
          id: "browser1",
          kind: "sql",
          source: "select * from dataframe",
          connectionMode: "dataframes",
          dataConnectionId: null,
          databaseSchema: null,
          parentSectionId: "section2",
        },
        signature: "select * from dataframe",
        dependencies: [
          { kind: "result", cellId: "warehouse1", name: "dataframe" },
        ],
      },
    ],
    browserSections: [
      { id: "section1", contents: { kind: "collapsible", collapsed: false } },
      { id: "section2", contents: { kind: "collapsible", collapsed: false } },
    ],
  };

  const { browser, render, unmount } = mountRun(accepted);

  callAction.mockImplementation(
    async (name: string, input: Record<string, unknown>) => {
      if (name === "admit-browser-notebook-run") {
        return {
          status: "admitted",
          runId: "browser-run",
          attemptId: "attempt",
          outputGeneration: crypto.randomUUID(),
        };
      }
      if (name === "complete-browser-notebook-run") return { status: "saved" };
      if (name === "cancel-notebook-run") return {};
      if (name === "start-notebook-run") {
        return {
          status: "admitted",
          runId: "warehouse-run",
          attempts: [
            {
              attempt: { cellId: "warehouse1" },
              state: { status: "complete", resultIds: ["warehouse-result-id"] },
            },
          ],
        };
      }
      if (name === "get-notebook-run") {
        return {
          status: "found",
          run: {
            attempts: [
              {
                attempt: { cellId: "warehouse1" },
                state: {
                  status: "complete",
                  resultIds: ["warehouse-result-id"],
                },
              },
            ],
          },
        };
      }
      if (name === "get-browser-notebook-input") {
        return {
          manifest: {
            result: {
              producer: { exportId: "dataframe" },
              resultId: "warehouse-result-id",
            },
            fields: [],
          },
          arrow: btoa("fake-arrow-bytes"),
        };
      }
      throw new Error(`Unexpected action: ${name}`);
    },
  );

  const handler = callAction.getMockImplementation();
  if (!handler) throw new Error("Missing action handler");

  try {
    await render();

    await act(async () => {
      await browser().start(
        accepted,
        runRequest(accepted, "run-section", "section1"),
      );
    });

    await act(async () => {
      await browser().start(
        accepted,
        runRequest(accepted, "cell-only", "browser1"),
      );
    });

    const calls = callAction.mock.calls.map(([name]) => name);
    expect(calls).toContain("get-browser-notebook-input");
    expect(browser().outputs.browser1?.status).toBe("complete");
  } finally {
    await unmount();
  }
  const reloaded: Execution = {
    ...accepted,
    cells: {
      warehouse1: {
        stale: false,
        resultId: "warehouse-result-id" as NonNullable<
          Execution["cells"][string]["resultId"]
        >,
        attempt: null,
        finishedAt: null,
      },
    },
  };
  const reopened = mountRun(reloaded);
  callAction.mockImplementation(handler);
  try {
    await reopened.render();
    await act(async () => {
      await reopened
        .browser()
        .start(reloaded, runRequest(reloaded, "cell-only", "browser1"));
    });
    expect(reopened.browser().outputs.browser1?.status).toBe("complete");
  } finally {
    await reopened.unmount();
  }
  const stale: Execution = {
    ...reloaded,
    cells: {
      warehouse1: {
        stale: true,
        resultId: reloaded.cells.warehouse1?.resultId ?? null,
        attempt: null,
        finishedAt: null,
      },
    },
  };
  const staleMount = mountRun(stale);
  try {
    await staleMount.render();
    await act(async () => {
      await staleMount
        .browser()
        .start(stale, runRequest(stale, "cell-only", "browser1"));
    });
    expect(staleMount.browser().outputs.browser1?.status).toBe("error");
  } finally {
    await staleMount.unmount();
  }
  const python: Execution = {
    ...reloaded,
    browserCells: reloaded.browserCells?.map((cell) =>
      cell.id === "warehouse1"
        ? {
            ...cell,
            contents: {
              ...contents,
              id: "warehouse1",
              source: "dataframe = 1",
            },
          }
        : cell,
    ),
  };
  const pythonMount = mountRun(python);
  callAction.mockImplementation(handler);
  try {
    await pythonMount.render();
    await act(async () => {
      await pythonMount
        .browser()
        .start(python, runRequest(python, "cell-only", "browser1"));
    });
    expect(pythonMount.browser().outputs.browser1?.status).toBe("error");
  } finally {
    await pythonMount.unmount();
  }
});

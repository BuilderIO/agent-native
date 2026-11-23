import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tableFromArrays, tableFromIPC, tableToIPC } from "apache-arrow";
import { loadPyodide, type PyodideAPI } from "pyodide";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  CONTRACT_VERSION,
  kernelCommandSchema,
} from "../../../shared/kernel-contract.js";
import { OfflineKernel, type OfflineDuckDB } from "./offline-kernel.js";

const require = createRequire(import.meta.url);
const duckdbFixtures = fileURLToPath(
  new URL("../../../.tmp/k0-duckdb/", import.meta.url),
);
const nodeDuckDB = path.join(duckdbFixtures, "duckdb-node-blocking.cjs");
const nodeWasm = path.join(duckdbFixtures, "duckdb-mvp.wasm");
const fixture = z
  .object({
    rows: z.array(z.number().int()),
    sqlSource: z.string(),
    producer: z.string(),
    consumer: z.string(),
    expected: z.tuple([z.number(), z.number()]),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../../../services/analytics-kernel/fixtures/analytics-roundtrip.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );

let python: PyodideAPI;

beforeAll(async () => {
  python = await loadPyodide({
    indexURL: path.dirname(require.resolve("pyodide/package.json")),
    jsglobals: Object.create(null),
  });
});

function envelope(
  id: string,
  command: z.input<typeof kernelCommandSchema>["command"],
  generation = "1",
) {
  return kernelCommandSchema.parse({
    protocolVersion: CONTRACT_VERSION,
    namespaceId: "offline-notebook",
    generation,
    commandId: id,
    runId: "offline-run",
    attemptId: "offline-attempt",
    resumeCursor: null,
    command,
  });
}

const packagedPython = fileURLToPath(
  new URL("../../../public/offline-kernel/pyodide/", import.meta.url),
);
type Execution = Extract<
  z.input<typeof kernelCommandSchema>["command"],
  { source: string }
>;
const bindings: Execution["inputs"] = [
  {
    name: "source_rows",
    manifest: {
      status: "complete",
      rowCount: "2",
      fields: [{ fieldId: "n", name: "n", type: "integer", nullable: false }],
      result: {
        resultId: "source-arrow",
        snapshot: {
          workspaceId: "local",
          projectId: "local-notebook",
          head: { versionId: "local-lineage", revision: "1" },
          eventSeq: "1",
        },
        producer: {
          namespaceId: "offline-notebook",
          runId: "upstream",
          attemptId: "upstream-attempt",
          cellId: "source",
          outputGeneration: "1",
          exportId: "source_rows",
        },
        inputRevision: "1",
        dependencyFingerprint: "local-source",
        kernelGeneration: null,
        sourceGeneration: null,
      },
    },
  },
];

async function loadDuckDB() {
  const module = require(nodeDuckDB) as {
    createDuckDB: (
      bundles: { mvp: { mainModule: string } },
      logger: unknown,
      runtime: unknown,
    ) => Promise<OfflineDuckDB & { instantiate: () => Promise<unknown> }>;
    NODE_RUNTIME: unknown;
    VoidLogger: new () => unknown;
  };
  const db = await module.createDuckDB(
    { mvp: { mainModule: nodeWasm } },
    new module.VoidLogger(),
    module.NODE_RUNTIME,
  );
  await db.instantiate();
  return db;
}

describe("offline notebook kernel", () => {
  it("registers an assignment-only Python dataframe for a SQL query in the same kernel", () => {
    const bytes = tableToIPC(tableFromArrays({ n: [42] }), "stream");
    let registered: Uint8Array | undefined;
    const kernel = new OfflineKernel(
      python,
      {
        open: () => {},
        connect: () => ({
          close: () => {},
          insertArrowFromIPCStream(data, options) {
            expect(options).toEqual({ name: "sales", create: true });
            registered = data;
          },
          useUnsafe: (run) =>
            run(
              {
                runQuery: () => new Uint8Array(),
                createPrepared: () => 1,
                runPrepared: () => {
                  if (!registered) throw new Error("Table sales not found");
                  return registered;
                },
                closePrepared: () => {},
              },
              0,
            ),
        }),
      },
      true,
    );
    const events: Parameters<Parameters<OfflineKernel["execute"]>[2]>[0][] = [];
    const send = (output: (typeof events)[number]) => events.push(output);
    try {
      kernel.execute(envelope("open", { operation: "open" }), new Map(), send);
      kernel.execute(
        envelope("python", {
          operation: "execute-python",
          inputs: [],
          source: `
import sys
from types import SimpleNamespace
from contextlib import nullcontext

class DataFrame:
    pass

sys.modules['pandas'] = SimpleNamespace(DataFrame=DataFrame)
sys.modules['pyarrow'] = SimpleNamespace(
    Table=SimpleNamespace(from_pandas=lambda *args, **kwargs: SimpleNamespace(schema=None)),
    BufferOutputStream=lambda: SimpleNamespace(getvalue=lambda: SimpleNamespace(to_pybytes=lambda: bytes(${JSON.stringify(Array.from(bytes))}))),
    ipc=SimpleNamespace(new_stream=lambda *args: nullcontext(SimpleNamespace(write_table=lambda table: None)))
)
Sales = DataFrame()
`,
        }),
        new Map(),
        send,
      );
      expect(events.at(-1)?.event.event).toEqual({
        type: "terminal",
        outcome: { status: "complete" },
      });
      expect(
        events.some(
          ({ artifact }) => artifact !== undefined && !artifact.metadata,
        ),
      ).toBe(false);
      const metadata = events.flatMap(({ artifact }) =>
        artifact?.format === "json"
          ? [JSON.parse(new TextDecoder().decode(artifact.bytes))]
          : [],
      );
      expect(metadata).toContainEqual(
        expect.objectContaining({
          kind: "variables",
          variables: expect.arrayContaining([
            expect.objectContaining({ name: "Sales", kind: "dataframe" }),
            expect.objectContaining({ name: "sys", kind: "module" }),
          ]),
          exports: expect.arrayContaining(["Sales", "sys"]),
        }),
      );
      const arrow = events.find(({ artifact }) => artifact?.format === "arrow");
      expect(
        tableFromIPC(arrow?.artifact?.bytes ?? new Uint8Array())
          .getChild("n")
          ?.get(0),
      ).toBe(42);

      events.length = 0;
      kernel.execute(
        envelope("sql", {
          operation: "execute-dataframe-sql",
          inputs: [],
          params: [],
          source: "SELECT n FROM Sales",
        }),
        new Map(),
        send,
      );
      expect(events.at(-1)?.event.event).toEqual({
        type: "terminal",
        outcome: { status: "complete" },
      });
      const result = events.find(
        ({ artifact }) => artifact?.format === "arrow",
      );
      expect(
        tableFromIPC(result?.artifact?.bytes ?? new Uint8Array())
          .getChild("n")
          ?.get(0),
      ).toBe(42);
    } finally {
      python.runPython(
        "import sys; sys.modules.pop('pandas', None); sys.modules.pop('pyarrow', None); pass",
      );
    }
  });

  it("prepares typed ordinal bindings without rewriting SQL string literals or comments", () => {
    let preparedSource = "";
    let preparedValues: (string | null)[] = [];
    const kernel = new OfflineKernel(
      python,
      {
        open: () => {},
        connect: () => ({
          close: () => {},
          insertArrowFromIPCStream: () => {},
          useUnsafe: (run) =>
            run(
              {
                runQuery: () => new Uint8Array(),
                createPrepared: (_connection, source) => {
                  preparedSource = source;
                  return 1;
                },
                runPrepared: (_connection, _statement, params) => {
                  preparedValues = params;
                  return tableToIPC(tableFromArrays({ n: [42] }), "stream");
                },
                closePrepared: () => {},
              },
              0,
            ),
        }),
      },
      false,
    );
    kernel.execute(
      envelope("open", { operation: "open" }),
      new Map(),
      () => {},
    );
    const command = envelope("query", {
      operation: "execute-dataframe-sql",
      source: "SELECT $1 AS n, '$2' AS literal /* $2 */, $2 AS amount",
      inputs: [],
      params: [
        { type: "INT64", value: "42" },
        { type: "NUMERIC", value: "42.250001" },
      ],
    });
    expect(
      kernel.execute(command, new Map(), () => {}).acknowledgement,
    ).toEqual({
      status: "accepted",
    });
    expect(preparedSource).toContain(
      "SELECT CAST($1 AS BIGINT) AS n, '$2' AS literal /* $2 */, CAST($2 AS DECIMAL(38,6)) AS amount",
    );
    expect(preparedValues).toEqual(["42", "42.250001"]);
  });

  it("keeps stdout before a Python traceback with the cell location", () => {
    const kernel = new OfflineKernel(python, null, false);
    const events: Array<
      Parameters<Parameters<OfflineKernel["execute"]>[2]>[0]["event"]["event"]
    > = [];
    const inputs = new Map<string, Uint8Array>();
    kernel.execute(envelope("open", { operation: "open" }), inputs, () => {});
    kernel.execute(
      envelope("failed-cell", {
        operation: "execute-python",
        source: 'print("before error")\nraise ValueError("broken")',
        inputs: [],
      }),
      inputs,
      ({ event }) => events.push(event.event),
    );
    const trace = events.findIndex(({ type }) => type === "error");
    const stdout = events.findIndex(
      (event) => event.type === "stream" && event.text.includes("before error"),
    );
    expect(stdout).toBeGreaterThanOrEqual(0);
    expect(trace).toBeGreaterThan(stdout);
    expect(events[trace]).toMatchObject({
      type: "error",
      line: 2,
      trace: expect.stringMatching(
        /^Traceback \(most recent call last\):[\s\S]*File "<cell>", line 2[\s\S]*ValueError: broken/,
      ),
    });
    expect(events.at(-1)).toMatchObject({
      type: "terminal",
      outcome: { status: "failed" },
    });
  });

  it("delivers each printed tick before Python continues to the next statement", () => {
    const kernel = new OfflineKernel(python, null, false);
    const observed: string[] = [];
    const artifacts = new Map<string, Uint8Array>();
    let stdout = "";
    python.registerJsModule("stream_probe", {
      checkpoint: () => observed.push(stdout),
    });
    try {
      kernel.execute(
        envelope("open", { operation: "open" }),
        artifacts,
        () => {},
      );
      kernel.execute(
        envelope("streaming-cell", {
          operation: "execute-python",
          source: `from stream_probe import checkpoint
for i in range(2):
    print(f"tick {i}", flush=True)
    checkpoint()`,
          inputs: [],
        }),
        artifacts,
        ({ event: { event } }) => {
          if (event.type === "stream") stdout += event.text;
          if (event.type === "terminal")
            observed.push(stdout, event.outcome.status);
        },
      );
      expect(observed).toEqual([
        "tick 0\n",
        "tick 0\ntick 1\n",
        "tick 0\ntick 1\n",
        "complete",
      ]);
    } finally {
      python.runPython(
        "import sys; sys.modules.pop('stream_probe', None); pass",
      );
      python.unregisterJsModule("stream_probe");
    }
  });

  it("links a JSONDecodeError to the notebook line that calls the decoder", () => {
    const kernel = new OfflineKernel(python, null, false);
    const artifacts = new Map<string, Uint8Array>();
    const events: Array<
      Parameters<Parameters<OfflineKernel["execute"]>[2]>[0]["event"]["event"]
    > = [];
    kernel.execute(
      envelope("open", { operation: "open" }),
      artifacts,
      () => {},
    );
    kernel.execute(
      envelope("json-error", {
        operation: "execute-python",
        source: 'print("before error")\nimport json\njson.loads("{bad json")',
        inputs: [],
      }),
      artifacts,
      ({ event }) => events.push(event.event),
    );
    expect(events.find(({ type }) => type === "error")).toMatchObject({
      type: "error",
      line: 3,
      exceptionName: "JSONDecodeError",
      exceptionMessage:
        "Expecting property name enclosed in double quotes: line 1 column 2 (char 1)",
      trace: expect.stringMatching(
        /File "<cell>", line 3[\s\S]*----> 3 json\.loads\("\{bad json"\)[\s\S]*json[\/]decoder.py[\s\S]*JSONDecodeError/,
      ),
    });
  });

  it("retains a multiline exception summary when a source frame exceeds eight kilobytes", () => {
    const kernel = new OfflineKernel(python, null, false);
    const events: Array<
      Parameters<Parameters<OfflineKernel["execute"]>[2]>[0]["event"]["event"]
    > = [];
    kernel.execute(
      envelope("open", { operation: "open" }),
      new Map(),
      () => {},
    );
    kernel.execute(
      envelope("long-trace", {
        operation: "execute-python",
        source: `# ${"é".repeat(5000)}\nraise ValueError("first line\\nsecond line")`,
        inputs: [],
      }),
      new Map(),
      ({ event }) => events.push(event.event),
    );
    const error = events.find(({ type }) => type === "error");
    expect(error).toMatchObject({
      exceptionName: "ValueError",
      exceptionMessage: "first line\nsecond line",
      trace: expect.stringMatching(
        /^Traceback \(most recent call last\):[\s\S]*----> 2 raise ValueError[\s\S]*\nValueError: first line\nsecond line\n$/,
      ),
    });
    const trace = error?.type === "error" ? error.trace : "";
    expect(new TextEncoder().encode(trace).byteLength).toBeLessThanOrEqual(
      8192,
    );
  });

  it("keeps stdout before a Python SystemExit and reports the authored exception", () => {
    const kernel = new OfflineKernel(python, null, false);
    const events: Array<
      Parameters<Parameters<OfflineKernel["execute"]>[2]>[0]["event"]["event"]
    > = [];
    kernel.execute(
      envelope("open", { operation: "open" }),
      new Map(),
      () => {},
    );
    kernel.execute(
      envelope("system-exit", {
        operation: "execute-python",
        source: 'print("before exit", end="")\nraise SystemExit("stopped")',
        inputs: [],
      }),
      new Map(),
      ({ event }) => events.push(event.event),
    );
    expect(events.slice(2)).toEqual([
      { type: "stream", channel: "stdout", text: "before exit" },
      {
        type: "error",
        reason: "execution_failed",
        line: 2,
        exceptionName: "SystemExit",
        exceptionMessage: "stopped",
        trace: expect.stringContaining("\nSystemExit: stopped\n"),
      },
      {
        type: "terminal",
        outcome: { status: "failed", reason: "execution_failed" },
      },
    ]);
  });

  it("shows the syntax compile frame and emits no stdout from invalid code", () => {
    const kernel = new OfflineKernel(python, null, false);
    const events: Array<
      Parameters<Parameters<OfflineKernel["execute"]>[2]>[0]["event"]["event"]
    > = [];
    kernel.execute(
      envelope("open", { operation: "open" }),
      new Map(),
      () => {},
    );
    kernel.execute(
      envelope("syntax-error", {
        operation: "execute-python",
        source: 'print("start")\nif True\n    pass',
        inputs: [],
      }),
      new Map(),
      ({ event }) => events.push(event.event),
    );
    expect(events.map(({ type }) => type)).toEqual([
      "queued",
      "ready",
      "error",
      "terminal",
    ]);
    expect(events[2]).toMatchObject({
      type: "error",
      line: 2,
      exceptionName: "SyntaxError",
      exceptionMessage: "expected ':'",
      trace: expect.stringMatching(
        /File "<unknown>", line 2\n +if True\n +\^\nSyntaxError: expected ':'/,
      ),
    });
  });

  it("returns a bounded diagnostic without a source line when the worker fails to stage Python input", () => {
    const kernel = new OfflineKernel(python, null, true);
    const events: Array<
      Parameters<Parameters<OfflineKernel["execute"]>[2]>[0]["event"]["event"]
    > = [];
    kernel.execute(
      envelope("open", { operation: "open" }),
      new Map(),
      () => {},
    );
    const message = "é".repeat(5000);
    vi.spyOn(python.FS, "writeFile").mockImplementationOnce(() => {
      throw new TypeError(message);
    });
    try {
      kernel.execute(
        envelope("worker-error", {
          operation: "execute-python",
          source: "source_rows",
          inputs: bindings,
        }),
        new Map([
          [
            "source-arrow",
            tableToIPC(tableFromArrays({ n: [1, 2] }), "stream"),
          ],
        ]),
        ({ event }) => events.push(event.event),
      );
    } finally {
      vi.restoreAllMocks();
    }
    expect(events[2]).toEqual({
      type: "error",
      reason: "execution_failed",
      line: null,
      trace: "é".repeat(4096),
      exceptionName: "TypeError",
      exceptionMessage: "é".repeat(4096),
    });
    expect(events[3]).toEqual({
      type: "terminal",
      outcome: { status: "failed", reason: "execution_failed" },
    });
  });

  it("replays a receipt without repeating Python and clears symbols on restart", () => {
    const kernel = new OfflineKernel(python, null, false);
    const artifacts = new Map();
    const outputs: Parameters<Parameters<OfflineKernel["execute"]>[2]>[0][] =
      [];
    const send = (output: (typeof outputs)[number]) => outputs.push(output);

    kernel.execute(envelope("open", { operation: "open" }), artifacts, send);
    const first = envelope("producer", {
      operation: "execute-python",
      source: `total = sum(${JSON.stringify(fixture.rows)})\nprint(total)\ntotal`,
      inputs: [],
    });
    const receipt = kernel.execute(first, artifacts, send);
    const eventCount = outputs.length;
    expect(kernel.execute(first, artifacts, send)).toEqual(receipt);
    expect(outputs).toHaveLength(eventCount);

    const consumer = {
      operation: "execute-python",
      source: fixture.consumer,
      inputs: [],
    } as const;
    const consumerCommand = envelope("consumer", { ...consumer, inputs: [] });
    kernel.execute(consumerCommand, artifacts, send);
    expect(
      outputs.flatMap(({ artifact }) =>
        artifact?.format === "json" && !artifact.metadata
          ? [JSON.parse(new TextDecoder().decode(artifact.bytes))]
          : [],
      ),
    ).toEqual(fixture.expected);
    expect(
      outputs
        .flatMap(({ event }) =>
          event.event.type === "stream" ? [event.event.text] : [],
        )
        .join(""),
    ).toBe("126\n127\n");
    expect(outputs.map(({ event }) => Number(event.sequence))).toEqual(
      outputs.map((_, index) => index + 1),
    );

    kernel.execute(
      envelope("restart", { operation: "restart" }, "2"),
      artifacts,
      send,
    );
    expect(
      kernel.execute(consumerCommand, artifacts, send).acknowledgement,
    ).toEqual({
      status: "stale",
      reason: "stale_generation",
    });
    kernel.execute(
      envelope("consumer-after-restart", { ...consumer, inputs: [] }, "2"),
      artifacts,
      send,
    );
    expect(outputs.at(-2)?.event.event).toMatchObject({
      type: "error",
      line: 1,
      trace: expect.stringContaining("NameError"),
    });
  });

  // oracle-change: requires the pinned DuckDB-Wasm fixtures from the offline asset build.
  it.skipIf(!existsSync(nodeDuckDB) || !existsSync(nodeWasm))(
    "round trips a complete Arrow artifact through DuckDB-Wasm without a warehouse",
    async () => {
      const db = await loadDuckDB();
      const kernel = new OfflineKernel(python, db, false);
      const completeArrow = tableToIPC(
        tableFromArrays({ n: new Int32Array(fixture.rows) }),
        "stream",
      );
      const artifacts = new Map([["source-arrow", completeArrow]]);
      kernel.execute(
        envelope("open", { operation: "open" }),
        artifacts,
        () => {},
      );
      const events: Parameters<Parameters<OfflineKernel["execute"]>[2]>[0][] =
        [];
      const input = envelope("sql", {
        operation: "execute-dataframe-sql",
        source: fixture.sqlSource.replace(" AS n", " + $1 AS n"),
        inputs: bindings,
        params: [{ type: "INT64", value: "1" }],
      });
      expect(
        kernel.execute(input, artifacts, (output) => events.push(output))
          .acknowledgement,
      ).toEqual({ status: "accepted" });
      expect(events.at(-1)?.event.event).toEqual({
        type: "terminal",
        outcome: { status: "complete" },
      });
      const result = events.find(
        ({ event }) => event.event.type === "result",
      )?.artifact;
      expect(result?.format).toBe("arrow");
      expect(
        tableFromIPC(result?.bytes ?? new Uint8Array())
          .getChild("n")
          ?.get(0),
      ).toBe(BigInt(fixture.expected[0] + 1));
      expect(
        kernel.execute(
          {
            ...input,
            commandId: "missing",
          },
          new Map(),
          () => {},
        ).acknowledgement,
      ).toEqual({ status: "absent", reason: "not_found" });
    },
  );
  // oracle-change: the full chain requires the packaged PyArrow and DuckDB-Wasm assets.
  it.skipIf(
    !existsSync(nodeDuckDB) ||
      !existsSync(nodeWasm) ||
      !existsSync(packagedPython),
  )(
    "runs the shared Arrow-to-DuckDB-to-Python notebook chain with packaged runtimes",
    async () => {
      const runtime = await loadPyodide({
        indexURL: packagedPython,
        jsglobals: Object.create(null),
      });
      await runtime.loadPackage("pyarrow");
      const kernel = new OfflineKernel(runtime, await loadDuckDB(), true);
      const artifacts = new Map([
        [
          "source-arrow",
          tableToIPC(
            tableFromArrays({ n: new Int32Array(fixture.rows) }),
            "stream",
          ),
        ],
      ]);
      const outputs: Parameters<Parameters<OfflineKernel["execute"]>[2]>[0][] =
        [];
      const send = (output: (typeof outputs)[number]) => outputs.push(output);
      const run = (id: string, command: Execution) =>
        kernel.execute(envelope(id, command), artifacts, send);

      kernel.execute(envelope("open", { operation: "open" }), artifacts, send);
      run("sql", {
        operation: "execute-dataframe-sql",
        source: fixture.sqlSource,
        inputs: bindings,
        params: [],
      });
      const sqlResult = outputs.find(
        ({ artifact }) => artifact?.format === "arrow",
      )?.artifact;
      if (!sqlResult) throw new Error("DuckDB did not emit its Arrow result");
      artifacts.set("source-arrow", sqlResult.bytes);
      const producer = fixture.producer.replace(
        /\ntotal$/,
        "\ndisplay(source_rows)\ntotal",
      );
      run("producer", {
        operation: "execute-python",
        source: producer,
        inputs: bindings.map((input) => ({
          ...input,
          manifest: { ...input.manifest, status: "complete", rowCount: "1" },
        })),
      });
      run("consumer", {
        operation: "execute-python",
        source: fixture.consumer,
        inputs: [],
      });
      const executionOutputs = outputs.filter(
        ({ event }) => event.commandId !== "open" && event.commandId !== "sql",
      );
      expect(
        executionOutputs.flatMap(({ artifact }) =>
          artifact?.format === "json" && !artifact.metadata
            ? [JSON.parse(new TextDecoder().decode(artifact.bytes))]
            : [],
        ),
      ).toEqual(fixture.expected);
      const display = executionOutputs.find(
        ({ event }) => event.event.type === "display",
      )?.artifact;
      if (display?.format !== "arrow")
        throw new Error("Python did not display an Arrow table");
      expect(tableFromIPC(display.bytes).getChild("n")?.get(0)).toBe(
        BigInt(fixture.expected[0]),
      );
      const terminals = executionOutputs.flatMap(({ event }) =>
        event.event.type === "terminal" ? [event.event.outcome.status] : [],
      );
      expect(terminals).toEqual(["complete", "complete"]);
    },
  );
});

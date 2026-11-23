import { PostgreSQL } from "@codemirror/lang-sql";
import { tableFromIPC, tableToIPC } from "apache-arrow";
import type { PyodideAPI } from "pyodide";
import type { PyCallable, PyDict } from "pyodide/ffi";
import { z } from "zod";

import {
  kernelAcknowledgementSchema,
  kernelCommandSchema,
  kernelEventSchema,
  type KernelAcknowledgement,
  type KernelCommand,
  type KernelEvent,
  type KernelSqlParameter,
} from "../../../shared/kernel-contract.js";
import {
  KERNEL_ERROR_TEXT_BYTES,
  KERNEL_EXCEPTION_NAME_BYTES,
  kernelExceptionFields,
} from "../../../shared/notebook-kernel-output.js";
import { sqlDataframeReferences } from "../../../shared/sql-dataframe-references.js";

const maxArtifactBytes = 32 * 1024 * 1024;
const maxOutputBytes = 1024 * 1024;
const maxSourceBytes = 256 * 1024;
const maxCommands = 512;
const bindingName = /^[A-Za-z_][A-Za-z0-9_]*$/;
let nextOutputDeviceMajor = 256;

type OutputEvent = KernelEvent["event"];
export type LocalArtifact = {
  format: "arrow" | "json" | "text";
  bytes: Uint8Array;
  metadata?: true;
};
type LocalOutput = { event: KernelEvent; artifact?: LocalArtifact };

export type OfflineDuckDB = {
  open: (config: { path: string }) => void;
  connect: () => {
    close: () => void;
    useUnsafe: (
      run: (
        bindings: {
          runQuery: (connection: number, source: string) => Uint8Array;
          createPrepared: (connection: number, source: string) => number;
          runPrepared: (
            connection: number,
            statement: number,
            params: (string | null)[],
          ) => Uint8Array;
          closePrepared: (connection: number, statement: number) => void;
        },
        connection: number,
      ) => Uint8Array,
    ) => Uint8Array;
    insertArrowFromIPCStream: (
      bytes: Uint8Array,
      options: { name: string; create: boolean },
    ) => void;
  };
};
const pythonEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stream"),
    channel: z.enum(["stdout", "stderr"]),
    text: z.string(),
  }),
  z.object({
    type: z.enum(["display", "result"]),
    format: z.enum(["arrow", "json", "text"]),
    value: z.string(),
    metadata: z.literal(true).optional(),
  }),
  z.object({
    type: z.literal("error"),
    trace: z.string(),
    line: z.number().int().positive().nullable(),
    ...kernelExceptionFields,
  }),
]);

const pythonRunner = String.raw`
import ast
import base64
import contextlib
import io
import itertools
import json
import sys
import symtable
import traceback
from types import FunctionType, ModuleType

cell_filenames = itertools.count()

def bounded_text(text, limit):
    return text.encode("utf-8", errors="replace")[:limit].decode("utf-8", errors="ignore")

def bounded_trace(body, summary, limit):
    body_bytes = body.encode("utf-8", errors="replace")
    if len(body_bytes) + len(summary.encode("utf-8", errors="replace")) <= limit:
        return body + summary
    marker = "\n…\n"
    available = limit - len(marker.encode("utf-8"))
    summary = bounded_text(summary, max(available // 2, available - len(body_bytes)))
    remaining = available - len(summary.encode("utf-8"))
    if len(body_bytes) <= remaining:
        return body + marker + summary
    middle = remaining // 2
    head = body_bytes[:middle].decode("utf-8", errors="ignore")
    tail = body_bytes[middle - remaining:].decode("utf-8", errors="ignore")
    return head + marker + tail + summary

def dataframe_arrow(value):
    import pyarrow as pa
    table = pa.Table.from_pandas(value, preserve_index=False)
    sink = pa.BufferOutputStream()
    with pa.ipc.new_stream(sink, table.schema) as writer:
        writer.write_table(table)
    return sink.getvalue().to_pybytes()

def read_dataframe(namespace, name, byte_limit):
    pandas = sys.modules.get("pandas")
    if not pandas:
        return None
    value = namespace.get(name)
    if value is None and name.isascii():
        value = next((namespace[key] for key in reversed(namespace) if isinstance(key, str) and key.isascii() and key.lower() == name.lower()), None)
    if not isinstance(value, pandas.DataFrame):
        return None
    data = dataframe_arrow(value)
    if len(data) > byte_limit:
        return False
    return base64.b64encode(data).decode()

def visible_variables(namespace):
    return {
        name: value for name, value in namespace.items()
        if isinstance(name, str)
        and name.isidentifier() and len(name.encode("utf-16-le")) <= 256
        and name != "display" and name != "_" and not name.startswith("__")
    }

def variable_kind(value, dataframe_type):
    if dataframe_type and isinstance(value, dataframe_type):
        return "dataframe"
    if isinstance(value, ModuleType):
        return "module"
    if isinstance(value, FunctionType):
        return "function"
    return "scalar"

def emit_exports(source, namespace, before, append):
    current = visible_variables(namespace)
    symbols = symtable.symtable(source, "<cell>", "exec").get_symbols()
    assigned = {symbol.get_name() for symbol in symbols if symbol.is_assigned() or symbol.is_imported()}
    exports = sorted(
        name for name, value in current.items()
        if name in assigned or name not in before or before[name] is not value
    )[:200]
    names = (exports + sorted(set(current) - set(exports)))[:200]
    dataframe_type = getattr(sys.modules.get("pandas"), "DataFrame", None)
    variables = []
    for name in names:
        value = current[name]
        kind = variable_kind(value, dataframe_type)
        label = type(value).__name__[:64]
        variables.append(dict(name=name, kind=kind, type=label))
        if name in exports and kind == "dataframe":
            append(dict(type="result", format="json", value=json.dumps(dict(kind="export", name=name)), metadata=True))
            arrow = base64.b64encode(dataframe_arrow(value)).decode()
            append(dict(type="result", format="arrow", value=arrow, metadata=True))
    append(dict(type="result", format="json", value=json.dumps(dict(kind="variables", variables=variables, exports=exports)), metadata=True))

def execute(source, namespace, paths, output_path):
    with open(output_path, "wb", buffering=0) as output:
        return execute_with_output(source, namespace, paths, output.write)

def execute_with_output(source, namespace, paths, write):
    filename = f"<notebook-cell-{next(cell_filenames)}>"

    class OutputLimit(Exception):
        pass

    def append(event):
        encoded = json.dumps(event, ensure_ascii=False).encode()
        if write(encoded) != len(encoded):
            raise OutputLimit()

    class Stream(io.TextIOBase):
        def __init__(self, channel):
            self.channel = channel

        def write(self, text):
            if text:
                append(dict(type="stream", channel=self.channel, text=text))
            return len(text)

    def value_event(kind, value):
        pandas = sys.modules.get("pandas")
        if pandas and isinstance(value, pandas.DataFrame):
            encoded = base64.b64encode(dataframe_arrow(value)).decode()
            append(dict(type=kind, format="arrow", value=encoded))
            return
        try:
            encoded = json.dumps(value, allow_nan=False)
        except (TypeError, ValueError):
            append(dict(type=kind, format="text", value=repr(value)))
        else:
            append(dict(type=kind, format="json", value=encoded))

    try:
        if paths:
            import pyarrow as pa
            for name, path in paths.items():
                with pa.ipc.open_stream(path) as artifact:
                    namespace[name] = artifact.read_all().to_pandas()
        namespace["display"] = lambda value: value_event("display", value)
        before = visible_variables(namespace)
        with contextlib.redirect_stdout(Stream("stdout")), contextlib.redirect_stderr(Stream("stderr")):
            tree = ast.parse(source, "<unknown>", "exec")
            last = tree.body[-1] if tree.body else None
            if isinstance(last, ast.Expr):
                tree.body.pop()
            code = compile(tree, filename, "exec")
            tail = compile(ast.Expression(last.value), filename, "eval") if isinstance(last, ast.Expr) else None
            exec(code, namespace)
            if tail is not None:
                value = eval(tail, namespace)
                if value is not None:
                    value_event("result", value)
        if source.strip():
            emit_exports(source, namespace, before, append)
    except OutputLimit:
        return True
    except BaseException as error:
        stack = traceback.extract_tb(error.__traceback__)
        cell_frames = [frame for frame in stack if frame.filename == filename]
        syntax = isinstance(error, SyntaxError)
        lines = source.split("\n")
        if syntax and error.filename == filename:
            error.filename = "<unknown>"
            if error.lineno and 1 <= error.lineno <= len(lines):
                error.text = lines[error.lineno - 1]
        line = cell_frames[-1].lineno if cell_frames else None
        if syntax and error.filename == "<unknown>" and error.lineno:
            line = error.lineno
        frames = stack[stack.index(cell_frames[0]):] if cell_frames else []
        parts = ["Traceback (most recent call last):\n"] if frames or syntax else []
        for frame in frames:
            if frame.filename == filename:
                parts.append(f'  File "<cell>", line {frame.lineno}, in {frame.name}\n')
                for number in range(max(1, frame.lineno - 2), min(len(lines), frame.lineno + 2) + 1):
                    arrow = "---->" if number == frame.lineno else "     "
                    parts.append(f"{arrow} {number} {lines[number - 1]}\n")
            else:
                parts.extend(traceback.format_list([frame]))
        name = type(error).__name__
        try:
            message = str(error.msg) if syntax else str(error)
        except BaseException:
            message = "<exception str() failed>"
        if syntax:
            *compile_frames, summary = traceback.format_exception_only(type(error), error)
            parts.extend(compile_frames)
        else:
            summary = f"{name}: {message}\n" if message else f"{name}\n"
        encoded = json.dumps(dict(
            type="error",
            trace=bounded_trace("".join(parts), summary, ${KERNEL_ERROR_TEXT_BYTES}),
            line=line,
            exceptionName=bounded_text(name, ${KERNEL_EXCEPTION_NAME_BYTES}),
            exceptionMessage=bounded_text(message, ${KERNEL_ERROR_TEXT_BYTES}),
        )).encode()
        return write(encoded) != len(encoded)
    return False
execute
`;

const encoder = new TextEncoder();

function duckdbName(name: string) {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

function boundedText(text: string, limit: number) {
  const bytes = new Uint8Array(limit);
  const { written } = encoder.encodeInto(text, bytes);
  return decoder.decode(bytes.subarray(0, written));
}

function parameterType({ type, value }: KernelSqlParameter): string {
  switch (type) {
    case "STRING":
      return "VARCHAR";
    case "INT64":
      return "BIGINT";
    case "FLOAT64":
      return "DOUBLE";
    case "BOOL":
      return "BOOLEAN";
    case "DATE":
      return "DATE";
    case "TIMESTAMP":
      return "TIMESTAMPTZ";
    case "NUMERIC": {
      if (value === null) return "DECIMAL(38,9)";
      const [, fractional = "", exponent = "0"] =
        /^[+-]?\d*(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value) ?? [];
      const scale = Math.max(0, fractional.length - Number(exponent));
      if (!Number.isSafeInteger(scale) || scale > 38)
        throw new Error("Decimal parameter is out of range");
      return `DECIMAL(38,${scale})`;
    }
  }
}

function typedPreparedSql(
  source: string,
  params: readonly KernelSqlParameter[],
) {
  if (params.length === 0) return source;
  let offset = 0;
  let output = "";
  PostgreSQL.language.parser.parse(source).iterate({
    enter(node) {
      if (node.name !== "Number" || source[node.from - 1] !== "$") return;
      const ordinal = source.slice(node.from, node.to);
      if (!/^\d+$/.test(ordinal)) return;
      const param = params[Number(ordinal) - 1];
      if (!param) return;
      output += source.slice(offset, node.from - 1);
      output += `CAST($${ordinal} AS ${parameterType(param)})`;
      offset = node.to;
    },
  });
  return output + source.slice(offset);
}

function acknowledgement(
  command: KernelCommand,
  status: KernelAcknowledgement["acknowledgement"],
) {
  const { command: _command, ...envelope } = command;
  return kernelAcknowledgementSchema.parse({
    ...envelope,
    acknowledgement: status,
  });
}

export class OfflineKernel {
  private namespace: PyDict | null = null;
  private generation: KernelCommand["generation"] | null = null;
  private namespaceId: KernelCommand["namespaceId"] | null = null;
  private closed = false;
  private sequence = 0;
  private submitted = new Map<
    string,
    { intent: string; receipt: KernelAcknowledgement }
  >();
  private runner: PyCallable;
  private dataframeReader: PyCallable;
  private readonly outputPath = `/dev/notebook-output-${crypto.randomUUID()}`;
  private receivePythonOutput?: (bytes: Uint8Array) => number;

  constructor(
    private python: PyodideAPI,
    private duckdb: OfflineDuckDB | null,
    private arrowPythonReady: boolean,
  ) {
    this.runner = python.runPython(pythonRunner) as PyCallable;
    this.dataframeReader = python.globals.get("read_dataframe") as PyCallable;
    const device = python.FS.makedev(nextOutputDeviceMajor++, 0);
    python.FS.registerDevice(device, {
      write: (
        _stream: unknown,
        buffer: Uint8Array,
        offset: number,
        length: number,
      ) =>
        this.receivePythonOutput?.(buffer.subarray(offset, offset + length)) ??
        0,
    });
    python.FS.mkdev(this.outputPath, 0o200, device);
  }

  execute(
    input: unknown,
    artifacts: ReadonlyMap<string, Uint8Array>,
    send: (output: LocalOutput) => void,
  ): KernelAcknowledgement {
    const command = kernelCommandSchema.parse(input);
    const operation = command.command.operation;
    const { command: _command, ...envelope } = command;
    const error = (status: KernelAcknowledgement["acknowledgement"]) =>
      acknowledgement(command, status);
    const stale = { status: "stale", reason: "stale_generation" } as const;
    const absent = { status: "absent", reason: "not_found" } as const;
    const unavailable = {
      status: "unreadable",
      reason: "read_failed",
    } as const;
    const quota = { status: "rejected", reason: "quota_exceeded" } as const;
    const emit = (event: OutputEvent, artifact?: LocalArtifact) => {
      send({
        event: kernelEventSchema.parse({
          ...envelope,
          sequence: String(++this.sequence),
          event,
        }),
        ...(artifact === undefined ? {} : { artifact }),
      });
    };

    if (this.namespaceId !== null && command.namespaceId !== this.namespaceId)
      return error({ status: "denied", reason: "access_denied" });
    if (
      this.generation !== null &&
      BigInt(command.generation) < BigInt(this.generation)
    )
      return error(stale);

    const prior = this.submitted.get(command.commandId);
    if (operation === "inspect") {
      return prior?.receipt.runId === command.runId &&
        prior.receipt.generation === command.generation
        ? error({ status: "accepted" })
        : error(absent);
    }
    const intent = JSON.stringify([
      command.generation,
      command.runId,
      command.attemptId,
      command.command,
    ]);
    if (prior && prior.receipt.generation === command.generation) {
      return prior.intent === intent
        ? prior.receipt
        : error({ status: "conflict", reason: "command_id_reused" });
    }

    if (operation === "open" && this.generation === null) {
      this.replaceNamespace(command);
    } else if (operation === "restart") {
      if (
        this.generation === null ||
        BigInt(command.generation) !== BigInt(this.generation) + 1n
      )
        return error(stale);
      this.replaceNamespace(command);
    } else {
      if (this.generation === null) return error(absent);
      if (command.generation !== this.generation || this.closed)
        return error(stale);
    }

    if (this.submitted.size >= maxCommands && operation !== "close")
      return error(quota);
    if (operation === "interrupt") return error(absent);
    if ("source" in command.command) {
      const { source, inputs } = command.command;
      if (encoder.encode(source).byteLength > maxSourceBytes)
        return error(quota);
      if (
        operation === "execute-python" &&
        inputs.length &&
        !this.arrowPythonReady
      )
        return error(unavailable);

      const inputBytes = new Map<string, Uint8Array>();
      let totalBytes = 0;
      for (const input of inputs) {
        const bytes = artifacts.get(input.manifest.result.resultId);
        if (!bytes) return error(absent);
        if (!bindingName.test(input.name) || inputBytes.has(input.name))
          return error({ status: "denied", reason: "access_denied" });
        totalBytes += bytes.byteLength;
        if (totalBytes > maxArtifactBytes) return error(quota);
        inputBytes.set(input.name, bytes);
      }
      const receipt = error({ status: "accepted" });
      this.submitted.set(command.commandId, { intent, receipt });
      emit({ type: "queued" });
      emit({ type: "ready" });
      try {
        const output = (
          type: "display" | "result",
          artifact: LocalArtifact,
        ) => {
          if (artifact.bytes.byteLength > maxArtifactBytes)
            throw new RangeError("Local output exceeded its byte limit");
          emit(
            {
              type,
              artifactId: crypto.randomUUID() as Extract<
                OutputEvent,
                { type: "display" | "result" }
              >["artifactId"],
            },
            artifact,
          );
        };
        if (command.command.operation === "execute-dataframe-sql") {
          output("result", {
            format: "arrow",
            bytes: this.query(source, inputBytes, command.command.params),
          });
        } else if (this.executePython(source, inputBytes, emit, output)) {
          return receipt;
        }
        emit({ type: "terminal", outcome: { status: "complete" } });
      } catch (failure) {
        const reason =
          failure instanceof RangeError ? "output_limit" : "execution_failed";
        if (reason === "execution_failed") {
          const trace =
            failure instanceof Error ? failure.message : String(failure);
          const message = boundedText(trace, KERNEL_ERROR_TEXT_BYTES);
          emit({
            type: "error",
            reason,
            trace: message,
            line: null,
            ...(operation === "execute-python" && failure instanceof Error
              ? {
                  exceptionName: boundedText(
                    failure.name,
                    KERNEL_EXCEPTION_NAME_BYTES,
                  ),
                  exceptionMessage: message,
                }
              : {}),
          });
        }
        emit({ type: "terminal", outcome: { status: "failed", reason } });
      }
      return receipt;
    }

    const receipt = error({ status: "accepted" });
    this.submitted.set(command.commandId, { intent, receipt });
    if (operation === "close") {
      this.namespace?.destroy();
      this.namespace = null;
      this.closed = true;
    } else {
      emit({ type: "ready" });
    }
    emit({ type: "terminal", outcome: { status: "complete" } });
    return receipt;
  }

  private replaceNamespace(command: KernelCommand) {
    this.namespace?.destroy();
    this.namespace = this.python.runPython("dict()") as PyDict;
    this.namespaceId = command.namespaceId;
    this.generation = command.generation;
    this.closed = false;
    this.sequence = 0;
    this.submitted.clear();
  }

  private executePython(
    source: string,
    inputs: ReadonlyMap<string, Uint8Array>,
    emit: (event: OutputEvent) => void,
    artifact: (type: "display" | "result", value: LocalArtifact) => void,
  ) {
    const files = new Map<string, string>();
    const paths = this.python.runPython("dict()") as PyDict;
    try {
      for (const [name, bytes] of inputs) {
        const path = `/tmp/${crypto.randomUUID()}.arrow`;
        this.python.FS.writeFile(
          path,
          tableToIPC(tableFromIPC(bytes), "stream"),
        );
        files.set(name, path);
        paths.set(name, path);
      }
      const received = { failed: false, bytes: 0 };
      const exports: { type: "display" | "result"; value: LocalArtifact }[] =
        [];
      this.receivePythonOutput = (bytes) => {
        if (received.failed || bytes.length > maxOutputBytes) return 0;
        const output = pythonEvent.parse(JSON.parse(decoder.decode(bytes)));
        if (output.type !== "error") {
          received.bytes += bytes.length;
          if (received.bytes > maxOutputBytes) return 0;
        }
        if ("format" in output) {
          const value: LocalArtifact = {
            format: output.format,
            bytes:
              output.format === "arrow"
                ? decodeBase64(output.value)
                : encoder.encode(output.value),
            ...(output.metadata ? { metadata: true } : {}),
          };
          if (output.metadata) exports.push({ type: output.type, value });
          else artifact(output.type, value);
        } else if (output.type === "error") {
          received.failed = true;
          emit({ ...output, reason: "execution_failed" });
        } else {
          emit(output);
        }
        return bytes.length;
      };
      const limited = z
        .boolean()
        .parse(this.runner(source, this.namespace, paths, this.outputPath));
      if (received.failed || limited) {
        emit({
          type: "terminal",
          outcome: {
            status: "failed",
            reason: limited ? "output_limit" : "execution_failed",
          },
        });
        return true;
      }
      for (const { type, value } of exports) artifact(type, value);
      return false;
    } finally {
      delete this.receivePythonOutput;
      paths.destroy();
      for (const path of files.values()) this.python.FS.unlink(path);
    }
  }

  private query(
    source: string,
    inputs: Map<string, Uint8Array>,
    params: readonly KernelSqlParameter[],
  ) {
    if (!this.duckdb) throw new Error("Local SQL runtime is unavailable");
    if (this.arrowPythonReady) {
      const bound = new Set([...inputs.keys()].map(duckdbName));
      let inputBytes = [...inputs.values()].reduce(
        (total, bytes) => total + bytes.byteLength,
        0,
      );
      for (const name of sqlDataframeReferences(source, {
        unqualifiedOnly: true,
        dialect: "duckdb",
      })) {
        const key = duckdbName(name);
        if (bound.has(key)) continue;
        const encoded: unknown = this.dataframeReader(
          this.namespace,
          name,
          maxArtifactBytes - inputBytes,
        );
        if (encoded === undefined) continue;
        if (encoded === false)
          throw new RangeError("Local input exceeded its byte limit");
        const bytes = decodeBase64(z.string().parse(encoded));
        inputs.set(name, bytes);
        bound.add(key);
        inputBytes += bytes.byteLength;
      }
    }
    const typedSource = typedPreparedSql(source, params);
    this.duckdb.open({ path: ":memory:" });
    const connection = this.duckdb.connect();
    try {
      connection.useUnsafe((binding, id) =>
        binding.runQuery(
          id,
          "SET enable_external_access = false; SET lock_configuration = true",
        ),
      );
      for (const [name, bytes] of inputs) {
        connection.insertArrowFromIPCStream(
          tableToIPC(tableFromIPC(bytes), "stream"),
          { name, create: true },
        );
      }
      return connection.useUnsafe((binding, id) => {
        const statement = binding.createPrepared(
          id,
          `SELECT * FROM (\n${typedSource.trim().replace(/;$/, "")}\n) AS notebook_result`,
        );
        try {
          return new Uint8Array(
            binding.runPrepared(
              id,
              statement,
              params.map(({ value }) => value),
            ),
          );
        } finally {
          binding.closePrepared(id, statement);
        }
      });
    } finally {
      connection.close();
    }
  }
}

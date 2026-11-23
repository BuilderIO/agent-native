import { createHash } from "node:crypto";

import { PostgreSQL } from "@codemirror/lang-sql";

import type { CellContents } from "../../../app/lib/model/contracts.js";
import {
  sectionRunTargets,
  type AttemptIdentity,
  type RunPlan,
  type RunRequest,
  type RunSectionCell,
} from "../../../shared/notebook-execution.js";
import type { CompleteResultManifest } from "../../../shared/notebook-result-contract.js";
import { sqlDataframeReferences } from "../../../shared/sql-dataframe-references.js";
import {
  sqlInputReferences,
  sqlTemplateBlock,
  sqlTemplateParameter,
} from "../../../shared/sql-input-name.js";

export type CellId = AttemptIdentity["cellId"];
type Contents = Extract<CellContents, { kind: "sql" | "code" | "input" }>;
export type ExecutionCell = { id: CellId; contents: Contents };
type Dependency = {
  name: string;
  cellId: CellId;
  kind: "input" | "result" | "options";
};
type Node = {
  cell: ExecutionCell;
  dependencies: Dependency[];
  signature: string;
  problem: RunPlan["rejectedCells"][number]["reason"] | undefined;
};

export type StoredPlan = {
  projection: RunPlan;
  cells: Node[];
  external: CompleteResultManifest[];
  executor?: "browser";
  previewPins?: Array<{
    cellId: CellId;
    resultId: CompleteResultManifest["result"]["resultId"];
  }>;
  selection?: { from: number; to: number; sourceSignature: string };
  cacheDonor?: string;
};
export type AvailableResult = {
  manifest: CompleteResultManifest;
  compatible: boolean;
  fresh: boolean;
};

export function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item: unknown) => {
        if (item === null || typeof item !== "object" || Array.isArray(item))
          return item;
        return Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
      }),
    )
    .digest("hex");
}

export function executionContents(contents: Contents) {
  switch (contents.kind) {
    case "input": {
      const {
        name,
        inputType,
        defaultValueString,
        options,
        optionValueType,
        dynamicOptions,
        optional,
      } = contents;
      return {
        kind: contents.kind,
        name,
        inputType,
        defaultValueString,
        options,
        optionValueType,
        dynamicOptions,
        optional,
      };
    }
    case "code": {
      const { language, source, resultVariable, outputResult } = contents;
      return {
        kind: contents.kind,
        language,
        source,
        resultVariable,
        outputResult,
      };
    }
    case "sql": {
      const {
        source,
        resultVariable,
        outputResult,
        dataConnectionId,
        connectionMode,
        databaseSchema,
        warehouseTable,
      } = contents;
      return {
        kind: contents.kind,
        source,
        resultVariable,
        outputResult,
        dataConnectionId,
        connectionMode,
        databaseSchema,
        ...(warehouseTable ? { warehouseTable } : {}),
      };
    }
  }
}

export function withPriorSqlResultName(current: Contents, prior: Contents) {
  return current.kind === "sql" &&
    prior.kind === "sql" &&
    current.resultVariable !== prior.resultVariable
    ? { ...current, resultVariable: prior.resultVariable }
    : current;
}

function executionSignature(
  contents: Contents,
  dependencies: Dependency[],
  signatures: (string | undefined)[],
) {
  return digest([executionContents(contents), dependencies, signatures]);
}

export function matchesExecutionSignature(
  current: Node | undefined,
  signature: string | null,
  prior: Node | undefined,
  dependencySignature: (id: CellId) => string | undefined,
) {
  if (!current) return false;
  if (signature === current.signature) return true;
  if (!prior) return false;
  const contents = withPriorSqlResultName(
    current.cell.contents,
    prior.cell.contents,
  );
  return (
    contents !== current.cell.contents &&
    signature ===
      executionSignature(
        contents,
        current.dependencies,
        current.dependencies.map(({ cellId }) => dependencySignature(cellId)),
      )
  );
}

function analyzeSql(contents: Extract<Contents, { kind: "sql" }>) {
  const text = contents.source
    .replace(sqlTemplateBlock, "$2")
    .replace(sqlTemplateParameter, "NULL");
  const parser = PostgreSQL.language.parser;
  const parsed =
    contents.dataConnectionId && !contents.connectionMode
      ? text.replace(
          /`([^`]+)`/g,
          (_match, name: string) => '"' + name.replaceAll('"', '""') + '"',
        )
      : text;
  // The Postgres grammar rejects a qualified star (`t.*`) that BigQuery and
  // DuckDB accept, which marked valid warehouse cells as parse errors and left
  // them without results. Neutralize it for the syntax check only.
  const tree = parser.parse(
    parsed
      .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.\*/g, "$1.c")
      .replace(/\b_/g, "u_"),
  );
  let invalid = !contents.source.trim() || /\{\{|\}\}/.test(text);
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) invalid = true;
    },
  });
  return {
    invalid,
    inputs: sqlInputReferences(contents.source),
    relations: sqlDataframeReferences(parsed, {
      unqualifiedOnly: true,
      dialect: contents.connectionMode === "dataframes" ? "duckdb" : "postgres",
    }),
  };
}

function pythonNames(source: string) {
  const declared = new Set<string>();
  for (const line of source.split("\n")) {
    const header = line.trim();
    if (!header) continue;
    if (!header.startsWith("#")) break;
    const names = /^# inputs:\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)$/.exec(
      header,
    )?.[1];
    if (names) for (const name of names.split(/\s*,\s*/)) declared.add(name);
  }
  const text = source.replace(
    /#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    (literal) => literal.replace(/[^\r\n]/g, " "),
  );
  const definitions = new Set<string>();
  const uses = new Set<string>();
  const local: { indent: number; names: Set<string> }[] = [];
  for (const line of text.split("\n")) {
    const code = line.trim();
    if (!code) continue;
    const indent = line.length - line.trimStart().length;
    while (local.at(-1) && (local.at(-1)?.indent ?? -1) >= indent) local.pop();
    const names = local.at(-1)?.names ?? definitions;
    const imported = /^(?:from\s+\S+\s+)?import\s+(.+)$/.exec(code)?.[1];
    if (imported) {
      for (const item of imported.replace(/[()]/g, "").split(",")) {
        const [moduleName, alias] = item.trim().split(/\s+as\s+/);
        const name = alias ?? moduleName?.split(".")[0];
        if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
      }
      continue;
    }
    const declaration =
      /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?[^:]*:/.exec(
        code,
      );
    if (declaration?.[1]) {
      names.add(declaration[1]);
      local.push({
        indent,
        names: new Set(
          (declaration[2] ?? "").split(",").flatMap((arg) => {
            const name = /^\*{0,2}([A-Za-z_]\w*)/.exec(arg.trim())?.[1];
            return name ? [name] : [];
          }),
        ),
      });
    }
    const body = declaration ? code.slice(declaration[0].length) : code;
    const assignment = /^([A-Za-z_]\w*)(?:\s*:[^=]+)?\s*=(?!=)/.exec(body);
    const expression = assignment ? body.slice(assignment[0].length) : body;
    for (const [name] of expression.matchAll(/(?<![.\w])[A-Za-z_]\w*/g)) {
      if (
        !definitions.has(name) &&
        !local.some((scope) => scope.names.has(name))
      )
        uses.add(name);
    }
    if (assignment?.[1]) names.add(assignment[1]);
  }
  return { definitions: [...definitions], uses, declared };
}

export function notebookGraph(cells: ExecutionCell[]): Node[] {
  const nodes: Node[] = [];
  const inputs = new Map<string, Node>();
  const results = new Map<string, Node[]>();
  const pythonResults = new Map<string, Node>();
  for (const cell of cells) {
    const { contents } = cell;
    const python =
      contents.kind === "code" ? pythonNames(contents.source) : null;
    const dependencies: Dependency[] = [];
    let problem: Node["problem"];
    const bind = (
      name: string,
      producer: Node | undefined,
      kind: Dependency["kind"],
    ) => {
      if (producer) dependencies.push({ name, cellId: producer.cell.id, kind });
      else problem ??= "missing_prerequisite";
    };
    if (contents.kind === "sql") {
      const sql = analyzeSql(contents);
      if (sql.invalid) problem = "parse_error";
      for (const name of sql.inputs) {
        const input = inputs.get(name);
        bind(name, input, "input");
        const inputContents = input?.cell.contents;
        const options =
          inputContents?.kind === "input"
            ? inputContents.dynamicOptions
            : undefined;
        if (options && input)
          bind(
            name,
            nodes
              .slice(0, nodes.indexOf(input))
              .find(({ cell }) => cell.id === options.producerCellId),
            "options",
          );
      }
      for (const name of sql.relations) {
        const prior = results.get(name.toLowerCase());
        if (contents.connectionMode === "dataframes") {
          bind(name, prior?.at(-1), "result");
        } else {
          const producer = prior
            ?.slice()
            .reverse()
            .find(
              ({ cell: { contents: candidate } }) =>
                candidate.kind === "sql" &&
                !candidate.connectionMode &&
                candidate.dataConnectionId === contents.dataConnectionId,
            );
          if (producer) bind(name, producer, "result");
        }
      }
    } else if (contents.kind === "code") {
      if (contents.language !== "python" || !contents.source.trim())
        problem = "parse_error";
      for (const name of python?.uses ?? []) {
        const producer = pythonResults.get(name);
        if (producer && !python?.declared.has(name))
          bind(name, producer, "result");
      }
      for (const name of python?.declared ?? [])
        bind(name, pythonResults.get(name), "result");
    }
    const signatures = dependencies.map(
      ({ cellId }) => nodes.find(({ cell }) => cell.id === cellId)?.signature,
    );
    const node = {
      cell,
      dependencies,
      problem,
      signature: executionSignature(contents, dependencies, signatures),
    };
    nodes.push(node);
    if (contents.kind === "input") inputs.set(contents.name, node);
    else {
      const names = python?.definitions ?? [];
      if (contents.resultVariable) names.push(contents.resultVariable);
      for (const name of names) pythonResults.set(name, node);
      for (const name of new Set(names.map((value) => value.toLowerCase()))) {
        const previous = results.get(name);
        if (previous) previous.push(node);
        else results.set(name, [node]);
      }
    }
  }
  return nodes;
}

export function planRun(
  nodes: Node[],
  request: RunRequest,
  available: ReadonlyMap<CellId, AvailableResult>,
  {
    reactiveInputs,
    sectionCells = [],
    pinned,
  }: {
    reactiveInputs?: readonly CellId[] | undefined;
    sectionCells?: readonly RunSectionCell[] | undefined;
    pinned?: ReadonlySet<CellId> | undefined;
  } = {},
): StoredPlan {
  const runnable = nodes.filter(({ cell }) => cell.contents.kind !== "input");
  const byId = new Map(runnable.map((node) => [node.cell.id, node]));
  const targets = new Set<CellId>();
  const sectionTargets =
    request.mode === "run-section"
      ? sectionRunTargets(
          nodes.map(({ cell }) => cell),
          sectionCells,
          request.targetCellId,
        )
      : undefined;
  if (request.mode === "run-all") {
    for (const node of runnable)
      if (!pinned?.has(node.cell.id)) targets.add(node.cell.id);
  } else if (request.mode === "run-section") {
    for (const { cell } of runnable)
      if (sectionTargets?.has(cell.id)) targets.add(cell.id);
  } else {
    for (const id of reactiveInputs ?? [request.targetCellId]) targets.add(id);
    if (request.mode === "auto" || request.mode === "downstream")
      for (const node of runnable)
        if (node.dependencies.some(({ cellId }) => targets.has(cellId)))
          targets.add(node.cell.id);
  }
  if (
    request.mode === "upstream" ||
    request.mode === "auto" ||
    request.mode === "run-section"
  ) {
    for (const id of targets) {
      const node = byId.get(id);
      for (const dependency of node?.dependencies ?? []) {
        if (dependency.kind === "input") continue;
        const result = available.get(dependency.cellId);
        if (request.mode === "upstream" || !result?.fresh || !result.compatible)
          targets.add(dependency.cellId);
      }
    }
  }

  const rejected = new Map<
    CellId,
    RunPlan["rejectedCells"][number]["reason"]
  >();
  const external = new Map<CellId, CompleteResultManifest>();
  for (const node of runnable) {
    if (!targets.has(node.cell.id)) continue;
    let reason = node.problem;
    const prerequisites = new Map<CellId, CompleteResultManifest>();
    for (const { cellId, kind } of node.dependencies) {
      if (kind === "input") continue;
      if (rejected.has(cellId)) reason ??= "incompatible_prerequisite";
      if (targets.has(cellId)) continue;
      const stored = available.get(cellId);
      if (!stored) reason ??= "missing_prerequisite";
      else if (
        !stored.compatible ||
        (!stored.fresh &&
          (request.mode === "run-all" ||
            request.staleValues !== "allow-compatible"))
      )
        reason ??= "incompatible_prerequisite";
      else prerequisites.set(cellId, stored.manifest);
    }
    if (reason) rejected.set(node.cell.id, reason);
    else for (const [id, manifest] of prerequisites) external.set(id, manifest);
  }
  if (
    request.mode !== "run-all" &&
    (request.mode === "run-section"
      ? sectionTargets === undefined
      : !nodes.some(({ cell }) => cell.id === request.targetCellId))
  )
    rejected.set(request.targetCellId, "missing_prerequisite");
  const admitted = runnable.filter(
    ({ cell }) => targets.has(cell.id) && !rejected.has(cell.id),
  );
  const required = new Set<CellId>();
  const addRequired = (id: CellId) => {
    if (required.has(id)) return;
    required.add(id);
    const node = byId.get(id) ?? nodes.find(({ cell }) => cell.id === id);
    for (const { cellId } of node?.dependencies ?? []) {
      addRequired(cellId);
    }
  };
  for (const { dependencies } of admitted) {
    for (const { cellId } of dependencies) {
      addRequired(cellId);
    }
  }
  return {
    cells: nodes.filter(
      ({ cell }) =>
        admitted.some(({ cell: accepted }) => accepted.id === cell.id) ||
        required.has(cell.id),
    ),
    external: [...external.values()],
    projection: {
      admittedCellIds: admitted.map(({ cell }) => cell.id),
      dependencyResultIds: [...external.values()].map(
        ({ result }) => result.resultId,
      ),
      rejectedCells: [...rejected].map(([cellId, reason]) => ({
        cellId,
        reason,
      })),
    },
  };
}

export function executionSource(contents: Contents) {
  return contents.kind === "sql"
    ? [
        contents.connectionMode,
        contents.dataConnectionId,
        contents.databaseSchema,
        ...(contents.warehouseTable ? [contents.warehouseTable] : []),
      ]
    : [contents.kind];
}

export function selectionGraph(
  cells: ExecutionCell[],
  targetCellId: CellId,
  selection: NonNullable<StoredPlan["selection"]>,
) {
  const target = cells.find(({ id }) => id === targetCellId);
  if (
    target?.contents.kind !== "sql" ||
    digest(executionContents(target.contents)) !== selection.sourceSignature ||
    selection.to > target.contents.source.length
  )
    return null;
  const source = target.contents.source.slice(selection.from, selection.to);
  if (!source.trim()) return null;
  return notebookGraph(
    cells.map((cell) =>
      cell === target
        ? { ...target, contents: { ...target.contents, source } }
        : cell,
    ),
  );
}

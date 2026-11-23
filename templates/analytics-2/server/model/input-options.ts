import { createHash } from "node:crypto";

import { fail } from "@agent-native/core/action";

import type { CellContents } from "../../app/lib/model/contracts.js";
import {
  resolveOptions,
  type TypedOption,
} from "../../app/lib/model/input-options.js";
import { readAccessibleProjectOutputs } from "./project-output-access.js";
import type { WorkspaceScope } from "./scope.js";
import { sqlTemplateInputNames } from "./sql-template.js";

type InputContents = Extract<CellContents, { kind: "input" }>;
type CellLike = { id: string; contents: CellContents };

export type InputChoices = {
  options: readonly TypedOption[];
  /**
   * Names the exact source query and saved result the choices came from. A run
   * that validated against one identity must not commit against another.
   */
  identity: string;
};

/**
 * Answers "which values may this input take" on the server, from the project's
 * saved results. A query-driven input is judged only by a complete result this
 * account may read; a pending, partial, unreadable or circular source is a
 * refusal, never an allowlist, and the client's own copy is never trusted.
 */
export function createInputChoiceResolver(args: {
  scope: Partial<WorkspaceScope>;
  projectId: string;
  /** The published version whose saved results are read; absent for the draft. */
  outputVersionId?: string | undefined;
  cells: readonly CellLike[];
  /** The action caller whose access policy each source's connections must allow. */
  caller?: string | undefined;
}) {
  const inputs = new Map<string, InputContents>();
  for (const cell of args.cells) {
    if (cell.contents.kind === "input") {
      inputs.set(cell.contents.name, cell.contents);
    }
  }
  const sourceOf = (input: InputContents): CellLike | undefined => {
    const source = input.optionsSource;
    if (source == null) return undefined;
    return args.cells.find(
      (cell) =>
        (cell.contents.kind === "sql" || cell.contents.kind === "code") &&
        cell.contents.resultVariable === source.dataframe,
    );
  };
  // An input depends on the inputs its source query templates in, and so on.
  const circular = (start: InputContents): boolean => {
    const seen = new Set<string>();
    const visit = (input: InputContents): boolean => {
      const cell = sourceOf(input);
      if (cell == null || cell.contents.kind !== "sql") return false;
      for (const name of sqlTemplateInputNames(cell.contents.source)) {
        if (name === start.name) return true;
        const dependency = inputs.get(name);
        if (dependency == null || seen.has(name)) continue;
        seen.add(name);
        if (visit(dependency)) return true;
      }
      return false;
    };
    return visit(start);
  };

  return async (input: InputContents): Promise<InputChoices> => {
    const source = input.optionsSource;
    if (source == null) {
      return {
        options: (input.options ?? []).map((text) => ({
          value: text,
          text,
          label: null,
        })),
        identity: "static",
      };
    }
    const sourceCell = sourceOf(input);
    if (sourceCell == null) {
      fail(`The query behind "${input.name}" is no longer in this project.`, {
        statusCode: 422,
        errorCode: "project_input_options_source_missing",
      });
    }
    if (circular(input)) {
      fail(
        `"${input.name}" cannot take its choices from a query that depends on it.`,
        { statusCode: 422, errorCode: "project_input_options_cycle" },
      );
    }
    const record = (
      await readAccessibleProjectOutputs(
        args.scope,
        args.projectId,
        args.outputVersionId,
        new Set([sourceCell.id]),
        args.caller ?? "unknown",
      )
    )[sourceCell.id];
    const output = record?.output ?? null;
    if (output?.type === "error") {
      fail(`The saved result of ${source.dataframe} is not available to you.`, {
        statusCode: 403,
        errorCode: "project_input_options_source_unavailable",
      });
    }
    if (
      record == null ||
      record.status !== "complete" ||
      output?.type !== "table"
    ) {
      fail(`Run ${source.dataframe} before using it for "${input.name}".`, {
        statusCode: 409,
        errorCode: "project_input_options_pending",
      });
    }
    const resolved = resolveOptions(source, {
      columns: output.columns,
      rows: output.rows,
      complete: !output.truncated,
    });
    if (resolved.status === "pending") {
      fail(`Run ${source.dataframe} before using it for "${input.name}".`, {
        statusCode: 409,
        errorCode: "project_input_options_pending",
      });
    }
    if (resolved.status === "missingColumn") {
      fail(`${source.dataframe} has no column named ${resolved.column}.`, {
        statusCode: 422,
        errorCode: "project_input_options_column_missing",
      });
    }
    if (resolved.status === "ambiguous") {
      fail(
        `${resolved.text} appears as both text and a number in ${source.dataframe}.`,
        { statusCode: 422, errorCode: "project_input_options_ambiguous" },
      );
    }
    if (resolved.incomplete) {
      fail(
        `The saved result of ${source.dataframe} is partial, so its values cannot validate "${input.name}".`,
        { statusCode: 409, errorCode: "project_input_options_incomplete" },
      );
    }
    return {
      options: resolved.options,
      identity: createHash("sha256")
        .update(
          JSON.stringify({
            source: sourceCell.contents,
            ranAt: record.ranAt,
            connection: record.sourceConnectionId,
            values: resolved.options.map((option) => [
              typeof option.value,
              option.text,
            ]),
          }),
        )
        .digest("hex"),
    };
  };
}

/** Refuses a selection outside the allowed values; the empty selection is always allowed. */
export function assertSelectionAllowed(
  selected: readonly string[],
  choices: InputChoices,
): void {
  const own = new Set(choices.options.map((option) => option.text));
  if (selected.some((value) => value !== "" && !own.has(value))) {
    fail("Invalid input value.", {
      statusCode: 400,
      errorCode: "project_input_invalid",
    });
  }
}

/** A selection as the typed values the source holds, so numbers bind as numbers. */
export function typedSelection(
  selected: readonly string[],
  choices: InputChoices,
): Array<string | number> {
  const byText = new Map(
    choices.options.map((option) => [option.text, option.value]),
  );
  return selected.map((text) => byText.get(text) ?? text);
}

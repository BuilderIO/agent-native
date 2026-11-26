import {
  type AcceptedRowDifference,
  captureRows,
  compareRowSnapshots,
  type EquivalenceReport,
  flattenModel,
  type RowSnapshot,
  type ScreenModel,
} from "@agent-native/design-system/model";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { DesignSystemContext } from "./context.js";
import {
  AGENT_NATIVE_PART_SET,
  type ModelRuntime,
  ModelSurface,
  type PartSet,
} from "./parts.js";

/** Draws a model with one part set in a DOM and returns its rendered rows. */
export async function renderModelRows(
  model: ScreenModel,
  partSet: PartSet,
  runtime: ModelRuntime = {},
): Promise<RowSnapshot[]> {
  const scope = globalThis as {
    IS_REACT_ACT_ENVIRONMENT?: boolean | undefined;
  };
  const previousActEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DesignSystemContext.Provider
          value={{ definition: { parts: partSet } }}
        >
          <ModelSurface model={model} {...runtime} />
        </DesignSystemContext.Provider>,
      );
    });
    return captureRows(container.ownerDocument);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    scope.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
}

export interface PartSetEquivalenceReport extends EquivalenceReport {
  /** Model rows a part set never rendered with its row attributes. */
  unrendered: { ours: string[]; target: string[] };
  /** True only when nothing differs, nothing is unrendered, and rows were compared. */
  equivalent: boolean;
}

function unrenderedRows(model: ScreenModel, rows: readonly RowSnapshot[]) {
  const rendered = new Set(rows.map((row) => row.id));
  return flattenModel(model)
    .map(({ row }) => row.id)
    .filter((id) => !rendered.has(id));
}

/**
 * The equivalence check: our part set against a target part set, drawn
 * from the same model. Structural only (rows, tree, names, states, effects);
 * the part sets are free to look different. Pass the target's documented
 * differences as `accepted`, each with its reason.
 */
export async function checkPartSetEquivalence({
  model,
  target,
  ours = AGENT_NATIVE_PART_SET,
  runtime,
  accepted = [],
}: {
  model: ScreenModel;
  target: PartSet;
  ours?: PartSet;
  runtime?: ModelRuntime;
  accepted?: readonly AcceptedRowDifference[];
}): Promise<PartSetEquivalenceReport> {
  const ourRows = await renderModelRows(model, ours, runtime);
  const targetRows = await renderModelRows(model, target, runtime);
  const report = compareRowSnapshots(ourRows, targetRows, accepted);
  const unrendered = {
    ours: unrenderedRows(model, ourRows),
    target: unrenderedRows(model, targetRows),
  };
  return {
    ...report,
    unrendered,
    equivalent:
      report.compared > 0 &&
      report.differences.length === 0 &&
      unrendered.ours.length === 0 &&
      unrendered.target.length === 0,
  };
}

import {
  operationsForKind,
  type NewNodeOptions,
  type NodeKind,
  type NodeVariant,
  type OperationDefinition,
  type WorkflowCatalog,
} from "@/lib/workflow-editor";

import type { WorkflowCanvasStrings } from "./strings";

export interface PaletteEntry {
  id: string;
  kind: NodeKind;
  label: string;
  /** Shown beside the label: the kind of step this adds. */
  category: string;
  options: Pick<NewNodeOptions, "operationId" | "variant">;
  /** What the search matches, beyond the label. */
  keywords: string;
  /** The integration a provider operation belongs to. Unset for steps that call no provider. */
  provider?: string;
  disabled?: boolean;
}

interface PaletteSection {
  id: "starts" | "next";
  heading: string;
  entries: PaletteEntry[];
}

function entry(
  s: WorkflowCanvasStrings,
  kind: NodeKind,
  label: string,
  options: PaletteEntry["options"] = {},
  extra: Partial<PaletteEntry> = {},
): PaletteEntry {
  const id = [kind, options.variant ?? "", options.operationId ?? ""]
    .filter(Boolean)
    .join(":");
  return {
    id,
    kind,
    label,
    category: s.kind[kind],
    options,
    keywords: `${s.kind[kind]} ${extra.keywords ?? ""}`.trim(),
    ...extra,
  };
}

function operationEntry(
  s: WorkflowCanvasStrings,
  kind: Extract<NodeKind, "source" | "lookup" | "action" | "agent">,
  def: OperationDefinition,
  variant?: NodeVariant,
): PaletteEntry {
  return entry(
    s,
    kind,
    def.label,
    { operationId: def.id, variant },
    { keywords: `${def.provider} ${def.id}`, provider: def.provider },
  );
}

/**
 * The steps a person can add, in two plain questions: what starts the
 * workflow, and what happens next. Operations come from the catalog, so a new
 * operation shows up here without a code change. A workflow that has a
 * trigger lists what happens next first, because the starts only add sources.
 */
export function buildPalette(
  catalog: WorkflowCatalog,
  context: { hasTrigger: boolean },
  s: WorkflowCanvasStrings,
): PaletteSection[] {
  const starts: PaletteEntry[] = [
    entry(
      s,
      "trigger",
      s.palette.onSchedule,
      {},
      { disabled: context.hasTrigger },
    ),
    entry(s, "source", s.palette.watchInbox, { variant: "inbox-poll" }),
    entry(s, "source", s.palette.itemsInStatus, { variant: "status" }),
    ...operationsForKind(catalog, "source").map((def) =>
      operationEntry(
        s,
        "source",
        def,
        def.window ? "window" : "provider-query",
      ),
    ),
  ];
  const next: PaletteEntry[] = [
    ...operationsForKind(catalog, "lookup").map((def) =>
      operationEntry(s, "lookup", def),
    ),
    ...operationsForKind(catalog, "action").map((def) =>
      operationEntry(s, "action", def),
    ),
    entry(s, "filter", s.palette.filter),
    entry(s, "switch", s.palette.switch),
    entry(s, "ai", s.palette.askAi),
    ...operationsForKind(catalog, "agent").map((def) =>
      operationEntry(s, "agent", def),
    ),
    entry(s, "wait", s.palette.waitReply, { variant: "reply" }),
    entry(s, "wait", s.palette.waitTime, { variant: "time" }),
    entry(s, "wait", s.palette.waitCondition, { variant: "condition" }),
    entry(s, "combine", s.palette.combineList, { variant: "list" }),
    entry(s, "combine", s.palette.combineCount, { variant: "count" }),
    entry(s, "combine", s.palette.combineGroup, { variant: "groupBy" }),
    entry(s, "combine", s.palette.combineSummarize, { variant: "summarize" }),
    entry(s, "split", s.palette.split),
    entry(s, "end", s.palette.finish),
  ];
  const sections: PaletteSection[] = [
    { id: "starts", heading: s.palette.startsGroup, entries: starts },
    { id: "next", heading: s.palette.nextGroup, entries: next },
  ];
  return context.hasTrigger ? sections.reverse() : sections;
}

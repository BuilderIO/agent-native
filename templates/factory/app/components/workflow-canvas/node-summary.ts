import type { WorkflowCatalog, WorkflowNode } from "@/lib/workflow-editor";

import { providerName } from "./node-kinds";
import type { WorkflowCanvasStrings } from "./strings";

function scheduleSummary(
  schedule: Extract<WorkflowNode, { kind: "trigger" }>["settings"]["schedule"],
  s: WorkflowCanvasStrings,
): string {
  if ("every" in schedule) {
    const minutes = Number.parseInt(schedule.every, 10);
    return minutes === 60
      ? s.summary.everyHour
      : s.summary.everyMinutes(minutes);
  }
  if ("daily" in schedule) return s.summary.dailyAt(schedule.daily.at);
  if ("weekdays" in schedule) return s.summary.weekdaysAt(schedule.weekdays.at);
  return s.summary.weeklyAt(s.weekday[schedule.weekly.day], schedule.weekly.at);
}

/** The second line of a node: what it does, in a few words. */
export function describeNode(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
  s: WorkflowCanvasStrings,
): string {
  const operation = (id: string) => catalog.get(id)?.label ?? id;
  switch (node.kind) {
    case "trigger":
      return scheduleSummary(node.settings.schedule, s);
    case "source":
      switch (node.settings.source) {
        case "inbox-poll":
          return s.summary.inbox(providerName(node.settings.poller));
        case "status":
          return s.summary.status(node.settings.status);
        default:
          return operation(node.settings.operation);
      }
    case "lookup":
    case "action":
      return operation(node.settings.operation);
    case "filter":
      return s.summary.rules(node.settings.rules.length);
    case "switch":
      return s.summary.routes(node.settings.routes.length);
    case "combine":
      return s.summary.combine[node.settings.mode];
    case "split":
      return node.settings.field;
    case "ai":
      return node.settings.mode === "perItem"
        ? s.summary.perItem
        : s.summary.wholeList;
    case "agent":
      return node.settings.op === "start"
        ? s.summary.agentStart
        : node.settings.op === "check"
          ? s.summary.agentCheck
          : s.summary.agentFollowUp;
    case "wait":
      switch (node.settings.wait) {
        case "reply":
          return s.summary.waitReply(node.settings.limitHours);
        case "time":
          return s.summary.waitTime(
            node.settings.duration.amount,
            node.settings.duration.unit,
          );
        case "condition":
          return s.summary.waitCondition(node.settings.limitHours);
      }
    case "end":
      return s.summary.end[node.settings.outcome];
  }
}

/**
 * The catalog label of the operation a step calls, or null for a step that
 * calls none. An operation the catalog does not know shows its id, as the
 * summary does, so a broken step is not hidden behind its kind's name.
 */
function operationLabel(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
): string | null {
  const labelOf = (operation: string) =>
    catalog.get(operation)?.label ?? operation;
  switch (node.kind) {
    case "source":
      switch (node.settings.source) {
        case "inbox-poll":
        case "status":
          return null;
        default:
          return labelOf(node.settings.operation);
      }
    case "lookup":
    case "action":
      return labelOf(node.settings.operation);
    default:
      return null;
  }
}

/**
 * The name under a tile. The person's label wins. Otherwise it is the operation
 * the step calls, or else its kind, with any number at the end of the identifier
 * kept: `filter2` reads "Filter 2". The identifier itself is never shown.
 */
export function nodeTitle(
  node: WorkflowNode,
  catalog: WorkflowCatalog,
  s: WorkflowCanvasStrings,
): string {
  if (node.label) return node.label;
  const base = operationLabel(node, catalog) ?? s.kind[node.kind];
  const digits = /(\d+)$/.exec(node.name)?.[1];
  return digits ? `${base} ${digits}` : base;
}

/**
 * Temporary: walks a strings object and records every string it produces, so
 * the catalog-backed strings can be compared with the English they replace.
 */
type Args = unknown[][];

const NODE_FN: Args = [[null], ["Check"]];

const WS_ARGS: Record<string, Args> = {
  "list.openWorkflow": [["Daily digest"]],
  "list.turnOn": [["Daily digest"]],
  "list.turnOff": [["Daily digest"]],
  "list.everyHours": [[1], [2], [24]],
  "list.nextRun": [["in 5 min"]],
  "list.waiting": [["3"], ["100+"]],
  "list.needsYou": [["2"]],
  "list.rowActions": [["Daily digest"]],
  "list.deleteTitle": [["Daily digest"]],
  "list.deleteParked": [["3"], ["100+"]],
  "list.deleteFailed": [["Server said no."]],
  "newDialog.createFailed": [["Server said no."]],
  "toolbar.problems": [[0], [1], [2], [12]],
  "toolbar.connectionsNeeded": [[1], [3]],
  "runPicker.version": [[3]],
  "runPicker.olderVersion": [[2, 5]],
  "versions.versionLabel": [[4]],
  "versions.confirmTitle": [[4]],
  "versions.restored": [[4]],
  "versions.restoreInvalid": [[0], [1], [3]],
  "save.invalid": [[0], [1], [2]],
  "save.failed": [["Boom."]],
  "save.serverIssue": [
    ["nodes.a", "bad"],
    ["", "bad"],
  ],
  "conflict.body": [[null], [7]],
  "run.failed": [["Boom."]],
  "run.liveFailed": [["Boom."]],
  "run.enableFailed": [["Boom."]],
  "diagnostics.failed": [["Boom."]],
};

const ITEMS_ARGS: Record<string, Args> = {
  "items.sheetTitle": [["Pay invoice"]],
  "where.atNode": [["Check"]],
  "where.parkedReply": [["Mon 9:00"]],
  "where.parkedTime": [["Mon 9:00"]],
  "where.parkedCondition": [["Mon 9:00"]],
  "duration.ms": [[250]],
  "duration.seconds": [["1.5"]],
  "duration.minutes": [
    [2, 0],
    [2, 30],
  ],
  "error.detail.action_unavailable": [["list-items"]],
  "error.codeLabel": [["bad_cursor"]],
  "journey.openInSource": [["Slack"]],
  "journey.inWorkflow": [["Digest"]],
  "journey.retryFailed": [["Server said no."]],
  "journey.dismissFailed": [["Server said no."]],
  "journey.pathRemoved": [[0], [1], [3]],
  "journey.run": [["Mon 9:00"]],
  "journey.receiptsTruncated": [[50]],
  "journey.parked.reply": [["Ask"]],
  "journey.parked.time": [["Ask"]],
  "journey.parked.condition": [["Ask"]],
  "journey.parked.due": [["in 2 h"]],
  "journey.parked.nextCheck": [["in 5 min"]],
  "journey.parked.slackThread": [["#bugs"]],
  "journey.parked.pullRequest": [
    ["acme/web", 12],
    [undefined, 12],
  ],
  "journey.parked.ticket": [["T-1"]],
  "journey.lease.held": [["run-1", "5 pm"]],
  "journey.lease.expired": [["run-1"]],
  "journey.attempts": [[0], [1], [3]],
  "journey.event.taken": NODE_FN,
  "journey.event.entered": NODE_FN,
  "journey.event.output": NODE_FN,
  "journey.event.decision": NODE_FN,
  "journey.event.effect": NODE_FN,
  "journey.event.parked": NODE_FN,
  "journey.event.woke": NODE_FN,
  "journey.event.error": NODE_FN,
  "journey.event.ended": [["Done"]],
  "journey.event.port": [["Match"]],
  "activity.runCounts.taken": [[0], [1], [4]],
  "activity.runCounts.done": [[3]],
  "activity.runCounts.dismissed": [[3]],
  "activity.runCounts.needsManual": [[3]],
  "activity.runCounts.released": [[3]],
  "activity.runCounts.itemFailures": [[0], [1], [2]],
  "activity.runCounts.needsCheck": [[2]],
  "activity.runCounts.summary": [["Took 3 items", "1 done, 1 released"]],
  "activity.changeText.saved": [[null], [3]],
  "activity.changeText.restored": [[null], [3]],
  "activity.handedOff": [["Pay invoice"]],
  "activity.link.version": [[null], [3]],
  "audit.scopedToRun": [["Mon 9:00"]],
  "audit.runsCount": [[0], [1], [5]],
  "audit.failureRate": [["12%"]],
  "audit.duration": [["1 s", "3 s"]],
  "audit.modes": [
    [3, 0, 0],
    [3, 1, 0],
    [3, 0, 2],
    [3, 1, 2],
    [0, 0, 0],
  ],
  "audit.fromNode": [[2, "Check", "Match"]],
  "audit.portCount": [["Match", 2]],
  "audit.moreItems": [[5, 20]],
  "audit.stepTruncated": [[100]],
  "audit.errorSteps": [[1], [3]],
  "audit.missingReceipts": [[1], [2]],
  "audit.atVersion": [[4]],
};

const CANVAS_ARGS: Record<string, Args> = {
  "summary.everyMinutes": [[5], [30]],
  "summary.dailyAt": [["09:00"]],
  "summary.weekdaysAt": [["09:00"]],
  "summary.weeklyAt": [["Mon", "09:00"]],
  "summary.inbox": [["Slack"]],
  "summary.status": [["needs_manual"]],
  "summary.rules": [[0], [1], [3]],
  "summary.routes": [[0], [1], [3]],
  "summary.waitReply": [[24]],
  "summary.waitTime": [
    [5, "minutes"],
    [2, "hours"],
    [3, "days"],
  ],
  "summary.waitCondition": [[24]],
  "palette.addAfterPort": [["Match"]],
  loopCap: [[1], [3]],
  waiting: [[4]],
  notConnected: [["HubSpot"]],
  "issue.edge": [["Check", "End"]],
  "inspector.renamedStale": [
    [1, "old"],
    [3, "old"],
  ],
  "inspector.staleWhere": [["Check", "the filter"]],
  "inspector.unknownField": [["foo"]],
  "inspector.notInCatalog": [["slack.post"]],
  "inspector.problem.unknown_node": [["foo"]],
  "inspector.problem.not_upstream": [["foo"]],
  "inspector.switchRoutes.newLabel": [[3]],
  "inspector.switchRoutes.confirmBody": [[0], [1], [3]],
};

const ISSUE_CODES = [
  "trigger_count",
  "duplicate_node_id",
  "duplicate_node_name",
  "duplicate_edge_id",
  "duplicate_switch_route",
  "edge_unknown_node",
  "edge_unknown_port",
  "edge_into_trigger",
  "port_leads_nowhere",
  "unreachable_node",
  "cycle_without_back_edge",
  "back_edge_without_cycle",
  "multiple_back_edges",
  "nested_loop",
  "loop_without_wait",
  "status_source_back_edge",
  "unknown_operation",
  "operation_kind_mismatch",
  "unknown_field",
  "missing_required_field",
  "enum_value_invalid",
  "field_type_mismatch",
  "bad_reference",
  "unknown_tool",
  "model_written_target",
];

export type Probe = Record<string, unknown>;

function walk(
  value: unknown,
  path: string,
  args: Record<string, Args>,
  out: Probe,
  special: (
    path: string,
    fn: (...a: never[]) => unknown,
    out: Probe,
  ) => boolean,
): void {
  if (typeof value === "string") {
    out[path] = value;
  } else if (typeof value === "function") {
    if (special(path, value as never, out)) return;
    const table = args[path];
    if (!table) throw new Error(`no probe arguments for ${path}`);
    for (const call of table) {
      out[`${path}(${JSON.stringify(call)})`] = (
        value as (...a: unknown[]) => unknown
      )(...call);
    }
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walk(entry, `${path}.${index}`, args, out, special),
    );
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      walk(
        (value as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        args,
        out,
        special,
      );
    }
  } else {
    throw new Error(`unexpected ${typeof value} at ${path}`);
  }
}

export function probeWorkflowStrings(strings: unknown): Probe {
  const out: Probe = {};
  walk(strings, "", WS_ARGS, out, () => false);
  return out;
}

export function probeItemsStrings(strings: unknown): Probe {
  const out: Probe = {};
  walk(strings, "", ITEMS_ARGS, out, () => false);
  return out;
}

export function probeCanvasStrings(strings: unknown): Probe {
  const out: Probe = {};
  walk(strings, "", CANVAS_ARGS, out, (path, fn, o) => {
    if (path !== "issue.sentence") return false;
    for (const code of ISSUE_CODES) {
      for (const detail of [undefined, "foo"]) {
        for (const port of [undefined, "Next"]) {
          const issue = detail === undefined ? { code } : { code, detail };
          o[`issue.sentence(${code},${detail},${port})`] = (
            fn as unknown as (i: unknown, p?: string) => string
          )(issue, port);
        }
      }
    }
    return true;
  });
  return out;
}

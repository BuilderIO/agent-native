import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import {
  lazyGroups,
  type NamespaceKey,
  type Translate,
} from "@/lib/typed-translate";
import type {
  NodeKind,
  RejectionCode,
  StepStatus,
  WorkflowIssue,
  WorkflowIssueCode,
} from "@/lib/workflow-editor";

type CanvasKey = NamespaceKey<"workflowCanvas">;

const WAIT_TIME_KEYS = {
  minutes: "workflowCanvas.summary.waitMinutes",
  hours: "workflowCanvas.summary.waitHours",
  days: "workflowCanvas.summary.waitDays",
} as const;

/** Every string the workflow canvas shows, read from the `workflowCanvas.*` catalog keys. */
export function createWorkflowCanvasStrings(t: Translate<CanvasKey>) {
  return lazyGroups({
    canvasName: () => t("workflowCanvas.canvasName"),
    kind: () =>
      ({
        trigger: t("workflowCanvas.kind.trigger"),
        source: t("workflowCanvas.kind.source"),
        lookup: t("workflowCanvas.kind.lookup"),
        action: t("workflowCanvas.kind.action"),
        filter: t("workflowCanvas.kind.filter"),
        switch: t("workflowCanvas.kind.switch"),
        combine: t("workflowCanvas.kind.combine"),
        split: t("workflowCanvas.kind.split"),
        ai: t("workflowCanvas.kind.ai"),
        agent: t("workflowCanvas.kind.agent"),
        wait: t("workflowCanvas.kind.wait"),
        end: t("workflowCanvas.kind.end"),
      }) satisfies Record<NodeKind, string>,
    port: () =>
      ({
        out: t("workflowCanvas.port.out"),
        match: t("workflowCanvas.port.match"),
        otherwise: t("workflowCanvas.port.otherwise"),
        limitReached: t("workflowCanvas.port.limitReached"),
        replied: t("workflowCanvas.port.replied"),
        timedOut: t("workflowCanvas.port.timedOut"),
        done: t("workflowCanvas.port.done"),
        met: t("workflowCanvas.port.met"),
      }) as Record<string, string>,
    status: () =>
      ({
        running: t("workflowCanvas.status.running"),
        succeeded: t("workflowCanvas.status.succeeded"),
        failed: t("workflowCanvas.status.failed"),
        skipped: t("workflowCanvas.status.skipped"),
        needs_check: t("workflowCanvas.status.needs_check"),
      }) satisfies Record<StepStatus, string>,
    summary: () => ({
      everyMinutes: (minutes: number) =>
        t("workflowCanvas.summary.everyMinutes", { count: minutes }),
      everyHour: t("workflowCanvas.summary.everyHour"),
      dailyAt: (time: string) => t("workflowCanvas.summary.dailyAt", { time }),
      weekdaysAt: (time: string) =>
        t("workflowCanvas.summary.weekdaysAt", { time }),
      weeklyAt: (day: string, time: string) =>
        t("workflowCanvas.summary.weeklyAt", { day, time }),
      inbox: (poller: string) => t("workflowCanvas.summary.inbox", { poller }),
      status: (status: string) =>
        t("workflowCanvas.summary.status", { status }),
      rules: (count: number) => t("workflowCanvas.summary.rules", { count }),
      routes: (count: number) => t("workflowCanvas.summary.routes", { count }),
      perItem: t("workflowCanvas.summary.perItem"),
      wholeList: t("workflowCanvas.summary.wholeList"),
      waitReply: (hours: number) =>
        t("workflowCanvas.summary.waitReply", { hours }),
      waitTime: (amount: number, unit: "minutes" | "hours" | "days") =>
        t(WAIT_TIME_KEYS[unit], { count: amount }),
      waitCondition: (hours: number) =>
        t("workflowCanvas.summary.waitCondition", { hours }),
      agentStart: t("workflowCanvas.summary.agentStart"),
      agentCheck: t("workflowCanvas.summary.agentCheck"),
      agentFollowUp: t("workflowCanvas.summary.agentFollowUp"),
      combine: {
        list: t("workflowCanvas.summary.combine.list"),
        count: t("workflowCanvas.summary.combine.count"),
        groupBy: t("workflowCanvas.summary.combine.groupBy"),
        summarize: t("workflowCanvas.summary.combine.summarize"),
      },
      end: {
        done: t("workflowCanvas.summary.end.done"),
        dismissed: t("workflowCanvas.summary.end.dismissed"),
        needsManual: t("workflowCanvas.summary.end.needsManual"),
        released: t("workflowCanvas.summary.end.released"),
      },
    }),
    weekday: () => [
      t("workflowCanvas.weekday.sun"),
      t("workflowCanvas.weekday.mon"),
      t("workflowCanvas.weekday.tue"),
      t("workflowCanvas.weekday.wed"),
      t("workflowCanvas.weekday.thu"),
      t("workflowCanvas.weekday.fri"),
      t("workflowCanvas.weekday.sat"),
    ],
    loopCap: () => (passes: number) =>
      t("workflowCanvas.loopCap", { count: passes }),
    waiting: () => (count: number) => t("workflowCanvas.waiting", { count }),
    notConnected: () => (provider: string) =>
      t("workflowCanvas.notConnected", { provider }),
    issue: () => ({
      edge: (from: string, to: string) =>
        t("workflowCanvas.issue.edge", { from, to }),
      graph: { trigger_count: t("workflowCanvas.issue.graph.trigger_count") },
      sentence: (issue: WorkflowIssue, portLabel?: string) =>
        issueSentence(t, issue, portLabel),
    }),
    palette: () => ({
      search: t("workflowCanvas.palette.search"),
      startsGroup: t("workflowCanvas.palette.startsGroup"),
      nextGroup: t("workflowCanvas.palette.nextGroup"),
      onSchedule: t("workflowCanvas.palette.onSchedule"),
      watchInbox: t("workflowCanvas.palette.watchInbox"),
      itemsInStatus: t("workflowCanvas.palette.itemsInStatus"),
      filter: t("workflowCanvas.palette.filter"),
      switch: t("workflowCanvas.palette.switch"),
      askAi: t("workflowCanvas.palette.askAi"),
      waitReply: t("workflowCanvas.palette.waitReply"),
      waitTime: t("workflowCanvas.palette.waitTime"),
      waitCondition: t("workflowCanvas.palette.waitCondition"),
      combineList: t("workflowCanvas.palette.combineList"),
      combineCount: t("workflowCanvas.palette.combineCount"),
      combineGroup: t("workflowCanvas.palette.combineGroup"),
      combineSummarize: t("workflowCanvas.palette.combineSummarize"),
      split: t("workflowCanvas.palette.split"),
      finish: t("workflowCanvas.palette.finish"),
      addAfterPort: (port: string) =>
        t("workflowCanvas.palette.addAfterPort", { port }),
    }),
    creator: () => ({
      searchPlaceholder: t("workflowCanvas.creator.searchPlaceholder"),
      triggers: t("workflowCanvas.creator.triggers"),
      actions: t("workflowCanvas.creator.actions"),
      flow: t("workflowCanvas.creator.flow"),
      ai: t("workflowCanvas.creator.ai"),
      back: t("workflowCanvas.creator.back"),
      connected: t("workflowCanvas.creator.connected"),
      notConnected: t("workflowCanvas.creator.notConnected"),
      connect: t("workflowCanvas.creator.connect"),
      describeIt: t("workflowCanvas.creator.describeIt"),
      insertOnEdge: t("workflowCanvas.creator.insertOnEdge"),
      insertBlockedLoop: t("workflowCanvas.creator.insertBlockedLoop"),
      noResults: t("workflowCanvas.creator.noResults"),
    }),
    toolbar: () => ({
      addStep: t("workflowCanvas.toolbar.addStep"),
      undo: t("workflowCanvas.toolbar.undo"),
      redo: t("workflowCanvas.toolbar.redo"),
      arrange: t("workflowCanvas.toolbar.arrange"),
      zoomIn: t("workflowCanvas.toolbar.zoomIn"),
      zoomOut: t("workflowCanvas.toolbar.zoomOut"),
      fitView: t("workflowCanvas.toolbar.fitView"),
      duplicate: t("workflowCanvas.toolbar.duplicate"),
      delete: t("workflowCanvas.toolbar.delete"),
    }),
    empty: () => ({
      none: t("workflowCanvas.empty.none"),
    }),
    canvasActions: () => ({
      addFirstStep: t("workflowCanvas.canvasActions.addFirstStep"),
      describeFirst: t("workflowCanvas.canvasActions.describeFirst"),
      describeFirstPrefill: t(
        "workflowCanvas.canvasActions.describeFirstPrefill",
      ),
      testWorkflow: t("workflowCanvas.canvasActions.testWorkflow"),
      saveAndTestWorkflow: t(
        "workflowCanvas.canvasActions.saveAndTestWorkflow",
      ),
    }),
    nodeActions: () => ({
      duplicate: t("workflowCanvas.nodeActions.duplicate"),
      remove: t("workflowCanvas.nodeActions.remove"),
    }),
    edge: () => ({
      toolbarName: t("workflowCanvas.edge.toolbarName"),
      loop: t("workflowCanvas.edge.loop"),
      passes: t("workflowCanvas.edge.passes"),
      remove: t("workflowCanvas.edge.remove"),
    }),
    inspector: () => ({
      panelName: t("workflowCanvas.inspector.panelName"),
      nameLabel: t("workflowCanvas.inspector.nameLabel"),
      closeLabel: t("workflowCanvas.inspector.closeLabel"),
      problemsHeading: t("workflowCanvas.inspector.problemsHeading"),
      renamedStale: (count: number, oldName: string) =>
        t("workflowCanvas.inspector.renamedStale", { count, oldName }),
      staleWhere: (nodeName: string, where: string) =>
        t("workflowCanvas.inspector.staleWhere", { nodeName, where }),
      mode: {
        fixed: t("workflowCanvas.inspector.mode.fixed"),
        path: t("workflowCanvas.inspector.mode.path"),
        ai: t("workflowCanvas.inspector.mode.ai"),
      },
      notSet: t("workflowCanvas.inspector.notSet"),
      clear: t("workflowCanvas.inspector.clear"),
      required: t("workflowCanvas.inspector.required"),
      unknownField: (name: string) =>
        t("workflowCanvas.inspector.unknownField", { name }),
      removeUnknownField: t("workflowCanvas.inspector.removeUnknownField"),
      jsonInvalid: t("workflowCanvas.inspector.jsonInvalid"),
      aiInstructionDefault: t("workflowCanvas.inspector.aiInstructionDefault"),
      aiInstructionLabel: t("workflowCanvas.inspector.aiInstructionLabel"),
      operation: t("workflowCanvas.inspector.operation"),
      noOperations: t("workflowCanvas.inspector.noOperations"),
      notInCatalog: (id: string) =>
        t("workflowCanvas.inspector.notInCatalog", { id }),
      resultName: t("workflowCanvas.inspector.resultName"),
      path: t("workflowCanvas.inspector.path"),
      pathExample: "item.title",
      insertPath: t("workflowCanvas.inspector.insertPath"),
      searchPaths: t("workflowCanvas.inspector.searchPaths"),
      noPaths: t("workflowCanvas.inspector.noPaths"),
      pathGroup: {
        itemField: t("workflowCanvas.fields.itemField"),
        settings: t("workflowCanvas.inspector.pathGroup.settings"),
        run: t("workflowCanvas.inspector.pathGroup.run"),
        steps: t("workflowCanvas.inspector.pathGroup.steps"),
        aiResult: t("workflowCanvas.fields.aiResult"),
      },
      problem: {
        empty_expression: t(
          "workflowCanvas.inspector.problem.empty_expression",
        ),
        unclosed_hole: t("workflowCanvas.inspector.problem.unclosed_hole", {
          open: "{{",
          close: "}}",
        }),
        unknown_root: t("workflowCanvas.inspector.problem.unknown_root"),
        unexpected_token: t(
          "workflowCanvas.inspector.problem.unexpected_token",
        ),
        bad_index: t("workflowCanvas.inspector.problem.bad_index"),
        forbidden_segment: t(
          "workflowCanvas.inspector.problem.forbidden_segment",
        ),
        path_too_long: t("workflowCanvas.inspector.problem.path_too_long"),
        missing_value: t("workflowCanvas.inspector.problem.missing_value"),
        not_renderable: t("workflowCanvas.inspector.problem.not_renderable"),
        no_node_name: t("workflowCanvas.inspector.problem.no_node_name"),
        unknown_node: (name: string) =>
          t("workflowCanvas.inspector.problem.unknown_node", { name }),
        not_upstream: (name: string) =>
          t("workflowCanvas.inspector.problem.not_upstream", { name }),
      },
      rules: {
        matchAll: t("workflowCanvas.inspector.rules.matchAll"),
        matchAny: t("workflowCanvas.inspector.rules.matchAny"),
        add: t("workflowCanvas.inspector.rules.add"),
        remove: t("workflowCanvas.inspector.rules.remove"),
        value: t("workflowCanvas.inspector.rules.value"),
        left: t("workflowCanvas.inspector.rules.left"),
        op: {
          equals: t("workflowCanvas.inspector.rules.op.equals"),
          notEquals: t("workflowCanvas.inspector.rules.op.notEquals"),
          contains: t("workflowCanvas.inspector.rules.op.contains"),
          startsWith: t("workflowCanvas.inspector.rules.op.startsWith"),
          isEmpty: t("workflowCanvas.inspector.rules.op.isEmpty"),
          isTrue: t("workflowCanvas.inspector.rules.op.isTrue"),
          inList: t("workflowCanvas.inspector.rules.op.inList"),
          gt: t("workflowCanvas.inspector.rules.op.gt"),
          lt: t("workflowCanvas.inspector.rules.op.lt"),
          between: t("workflowCanvas.inspector.rules.op.between"),
          olderThan: t("workflowCanvas.inspector.rules.op.olderThan"),
          pastDue: t("workflowCanvas.inspector.rules.op.pastDue"),
        },
        listHint: t("workflowCanvas.inspector.rules.listHint"),
      },
      trigger: {
        schedule: t("workflowCanvas.inspector.trigger.schedule"),
        every: t("workflowCanvas.inspector.trigger.every"),
        at: t("workflowCanvas.inspector.trigger.at"),
        day: t("workflowCanvas.inspector.trigger.day"),
        timezone: t("workflowCanvas.inspector.trigger.timezone"),
        kinds: {
          every: t("workflowCanvas.inspector.trigger.kinds.every"),
          daily: t("workflowCanvas.inspector.trigger.kinds.daily"),
          weekdays: t("workflowCanvas.inspector.trigger.kinds.weekdays"),
          weekly: t("workflowCanvas.inspector.trigger.kinds.weekly"),
        },
        intervals: {
          "5m": t("workflowCanvas.inspector.trigger.intervals.5m"),
          "10m": t("workflowCanvas.inspector.trigger.intervals.10m"),
          "15m": t("workflowCanvas.inspector.trigger.intervals.15m"),
          "30m": t("workflowCanvas.inspector.trigger.intervals.30m"),
          "60m": t("workflowCanvas.inspector.trigger.intervals.60m"),
        },
      },
      source: {
        kind: t("workflowCanvas.inspector.source.kind"),
        kinds: {
          "inbox-poll": t("workflowCanvas.inspector.source.kinds.inbox-poll"),
          "provider-query": t(
            "workflowCanvas.inspector.source.kinds.provider-query",
          ),
          window: t("workflowCanvas.inspector.source.kinds.window"),
          status: t("workflowCanvas.inspector.source.kinds.status"),
        },
        poller: t("workflowCanvas.inspector.source.poller"),
        takeLimit: t("workflowCanvas.inspector.source.takeLimit"),
        maxItems: t("workflowCanvas.inspector.source.maxItems"),
        memory: t("workflowCanvas.inspector.source.memory"),
        memoryInbox: t("workflowCanvas.inspector.source.memoryInbox"),
        memoryNone: t("workflowCanvas.inspector.source.memoryNone"),
        status: t("workflowCanvas.inspector.source.status"),
        filters: t("workflowCanvas.inspector.source.filters"),
        scope: {
          slack: {
            label: t("workflowCanvas.inspector.source.scope.slack.label"),
            example: t("workflowCanvas.inspector.source.scope.slack.example"),
            invalid: t("workflowCanvas.inspector.source.scope.slack.invalid"),
          },
          github: {
            label: t("workflowCanvas.inspector.source.scope.github.label"),
            example: t("workflowCanvas.inspector.source.scope.github.example"),
            invalid: t("workflowCanvas.inspector.source.scope.github.invalid"),
          },
          sentry: {
            label: t("workflowCanvas.inspector.source.scope.sentry.label"),
            example: t("workflowCanvas.inspector.source.scope.sentry.example"),
            invalid: t("workflowCanvas.inspector.source.scope.sentry.invalid"),
          },
        },
        authors: t("workflowCanvas.inspector.source.authors"),
        excludeAuthors: t("workflowCanvas.inspector.source.excludeAuthors"),
        claimReaction: t("workflowCanvas.inspector.source.claimReaction"),
      },
      combine: {
        mode: t("workflowCanvas.inspector.combine.mode"),
        key: t("workflowCanvas.inspector.combine.key"),
        field: t("workflowCanvas.inspector.combine.field"),
        group: t("workflowCanvas.inspector.combine.group"),
        value: t("workflowCanvas.inspector.combine.value"),
        agg: t("workflowCanvas.inspector.combine.agg"),
        aggs: {
          sum: t("workflowCanvas.inspector.combine.aggs.sum"),
          count: t("workflowCanvas.inspector.combine.aggs.count"),
          avg: t("workflowCanvas.inspector.combine.aggs.avg"),
        },
        baseline: t("workflowCanvas.inspector.combine.baseline"),
        window: t("workflowCanvas.inspector.combine.window"),
        bucket: t("workflowCanvas.inspector.combine.bucket"),
        buckets: {
          day: t("workflowCanvas.inspector.combine.buckets.day"),
          week: t("workflowCanvas.inspector.combine.buckets.week"),
        },
        compare: t("workflowCanvas.inspector.combine.compare"),
      },
      split: { field: t("workflowCanvas.inspector.split.field") },
      ai: {
        mode: t("workflowCanvas.inspector.ai.mode"),
        modes: {
          perItem: t("workflowCanvas.inspector.ai.modes.perItem"),
          wholeList: t("workflowCanvas.inspector.ai.modes.wholeList"),
        },
        resultHeading: t("workflowCanvas.inspector.ai.resultHeading"),
        fieldName: t("workflowCanvas.inspector.ai.fieldName"),
        types: {
          boolean: t("workflowCanvas.inspector.ai.types.boolean"),
          string: t("workflowCanvas.inspector.ai.types.string"),
          number: t("workflowCanvas.inspector.ai.types.number"),
          enum: t("workflowCanvas.inspector.ai.types.enum"),
          array: t("workflowCanvas.inspector.ai.types.array"),
        },
        optional: t("workflowCanvas.inspector.ai.optional"),
        values: t("workflowCanvas.inspector.ai.values"),
        addField: t("workflowCanvas.inspector.ai.addField"),
        removeField: t("workflowCanvas.inspector.ai.removeField"),
        newFieldValue: "value1",
        batchSize: t("workflowCanvas.inspector.ai.batchSize"),
        tools: t("workflowCanvas.inspector.ai.tools"),
        inputBudget: t("workflowCanvas.inspector.ai.inputBudget"),
      },
      agent: {
        operation: t("workflowCanvas.inspector.agent.operation"),
        none: t("workflowCanvas.inspector.agent.none"),
      },
      wait: {
        kind: t("workflowCanvas.inspector.wait.kind"),
        kinds: {
          reply: t("workflowCanvas.inspector.wait.kinds.reply"),
          time: t("workflowCanvas.inspector.wait.kinds.time"),
          condition: t("workflowCanvas.inspector.wait.kinds.condition"),
        },
        limitHours: t("workflowCanvas.inspector.wait.limitHours"),
        acceptFrom: t("workflowCanvas.inspector.wait.acceptFrom"),
        anyone: t("workflowCanvas.inspector.wait.anyone"),
        owner: t("workflowCanvas.inspector.wait.owner"),
        people: t("workflowCanvas.inspector.wait.people"),
        emails: t("workflowCanvas.inspector.wait.emails"),
        watch: t("workflowCanvas.inspector.wait.watch"),
        ownThread: t("workflowCanvas.inspector.wait.ownThread"),
        ackReaction: t("workflowCanvas.inspector.wait.ackReaction"),
        amount: t("workflowCanvas.inspector.wait.amount"),
        unit: t("workflowCanvas.inspector.wait.unit"),
        units: {
          minutes: t("workflowCanvas.inspector.wait.units.minutes"),
          hours: t("workflowCanvas.inspector.wait.units.hours"),
          days: t("workflowCanvas.inspector.wait.units.days"),
        },
        everyMinutes: t("workflowCanvas.inspector.wait.everyMinutes"),
        rule: t("workflowCanvas.inspector.wait.rule"),
      },
      end: {
        outcome: t("workflowCanvas.inspector.end.outcome"),
        reason: t("workflowCanvas.inspector.end.reason"),
        setStatus: t("workflowCanvas.inspector.end.setStatus"),
      },
      switchRoutes: {
        heading: t("workflowCanvas.inspector.switchRoutes.heading"),
        routeName: t("workflowCanvas.inspector.switchRoutes.routeName"),
        newLabel: (n: number) =>
          t("workflowCanvas.inspector.switchRoutes.newLabel", { n }),
        add: t("workflowCanvas.inspector.switchRoutes.add"),
        remove: t("workflowCanvas.inspector.switchRoutes.remove"),
        otherwise: t("workflowCanvas.inspector.switchRoutes.otherwise"),
        confirmTitle: t("workflowCanvas.inspector.switchRoutes.confirmTitle"),
        confirmBody: (count: number) =>
          count === 1
            ? t("workflowCanvas.inspector.switchRoutes.confirmBodyOne")
            : t("workflowCanvas.inspector.switchRoutes.confirmBody", { count }),
        confirm: t("workflowCanvas.inspector.switchRoutes.confirm"),
        cancel: t("workflowCanvas.inspector.switchRoutes.cancel"),
      },
    }),
    rejection: () =>
      ({
        unknown_node: t("workflowCanvas.rejection.unknown_node"),
        unknown_edge: t("workflowCanvas.rejection.unknown_edge"),
        unknown_port: t("workflowCanvas.rejection.unknown_port"),
        edge_into_trigger: t("workflowCanvas.rejection.edge_into_trigger"),
        self_loop: t("workflowCanvas.rejection.self_loop"),
        duplicate_connection: t(
          "workflowCanvas.rejection.duplicate_connection",
        ),
        limit_port_back_edge: t(
          "workflowCanvas.rejection.limit_port_back_edge",
        ),
        trigger_exists: t("workflowCanvas.rejection.trigger_exists"),
        node_limit: t("workflowCanvas.rejection.node_limit"),
        edge_limit: t("workflowCanvas.rejection.edge_limit"),
        operation_required: t("workflowCanvas.rejection.operation_required"),
        operation_mismatch: t("workflowCanvas.rejection.operation_mismatch"),
        invalid_name: t("workflowCanvas.rejection.invalid_name"),
        duplicate_name: t("workflowCanvas.rejection.duplicate_name"),
        invalid_settings: t("workflowCanvas.rejection.invalid_settings"),
        invalid_iterations: t("workflowCanvas.rejection.invalid_iterations"),
        invalid_position: t("workflowCanvas.rejection.invalid_position"),
      }) satisfies Record<RejectionCode, string>,
  });
}

export type WorkflowCanvasStrings = ReturnType<
  typeof createWorkflowCanvasStrings
>;

export function useWorkflowCanvasStrings(): WorkflowCanvasStrings {
  const t = useT();
  return useMemo(() => createWorkflowCanvasStrings(t), [t]);
}

function issueSentence(
  t: Translate<CanvasKey>,
  issue: WorkflowIssue,
  portLabel?: string,
): string | undefined {
  const detail = issue.detail ?? "";
  const sentences: Record<WorkflowIssueCode, () => string> = {
    trigger_count: () => t("workflowCanvas.issue.graph.trigger_count"),
    duplicate_node_id: () => t("workflowCanvas.issue.duplicate_node_id"),
    duplicate_node_name: () =>
      t("workflowCanvas.issue.duplicate_node_name", { detail }),
    duplicate_edge_id: () => t("workflowCanvas.issue.duplicate_edge_id"),
    duplicate_switch_route: () =>
      t("workflowCanvas.issue.duplicate_switch_route", { detail }),
    edge_unknown_node: () => t("workflowCanvas.issue.edge_unknown_node"),
    edge_unknown_port: () => t("workflowCanvas.issue.edge_unknown_port"),
    edge_into_trigger: () => t("workflowCanvas.rejection.edge_into_trigger"),
    port_leads_nowhere: () =>
      portLabel
        ? t("workflowCanvas.issue.port_leads_nowhere", { port: portLabel })
        : t("workflowCanvas.issue.port_leads_nowhere_plain"),
    unreachable_node: () => t("workflowCanvas.issue.unreachable_node"),
    cycle_without_back_edge: () =>
      t("workflowCanvas.issue.cycle_without_back_edge"),
    back_edge_without_cycle: () =>
      t("workflowCanvas.issue.back_edge_without_cycle"),
    multiple_back_edges: () => t("workflowCanvas.issue.multiple_back_edges"),
    nested_loop: () => t("workflowCanvas.issue.nested_loop"),
    loop_without_wait: () => t("workflowCanvas.issue.loop_without_wait"),
    status_source_back_edge: () =>
      t("workflowCanvas.issue.status_source_back_edge"),
    unknown_operation: () =>
      t("workflowCanvas.issue.unknown_operation", { detail }),
    operation_kind_mismatch: () =>
      t("workflowCanvas.issue.operation_kind_mismatch"),
    unknown_field: () => detail || t("workflowCanvas.issue.unknown_field"),
    missing_required_field: () =>
      detail || t("workflowCanvas.issue.missing_required_field"),
    enum_value_invalid: () =>
      detail || t("workflowCanvas.issue.enum_value_invalid"),
    field_type_mismatch: () =>
      detail || t("workflowCanvas.issue.field_type_mismatch"),
    bad_reference: () =>
      detail
        ? t("workflowCanvas.issue.bad_reference", { detail })
        : t("workflowCanvas.issue.bad_reference_plain"),
    unknown_tool: () => detail || t("workflowCanvas.issue.unknown_tool"),
    model_written_target: () =>
      detail || t("workflowCanvas.issue.model_written_target"),
  };
  return sentences[issue.code]?.();
}
